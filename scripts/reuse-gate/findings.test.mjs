import assert from "node:assert/strict";
import test from "node:test";

import { reuseFindings } from "./findings.mjs";

const reuseSection = [
  "<!-- reuse-rule:start -->",
  "## Reuse before writing code",
  "",
  "Ask which existing module can do this.",
  "<!-- reuse-rule:end -->",
].join("\n");

function guidance(agentsSection = reuseSection, claudeSection = reuseSection) {
  return [
    { file: "AGENTS.md", source: `# Agents\n\nConcise answers.\n\n${agentsSection}\n` },
    { file: "CLAUDE.md", source: `# Claude\n\nDifferent opening.\n\n${claudeSection}\n` },
  ];
}

function inputs({
  guidanceFiles = guidance(),
  documents = [],
  repository = {},
  catalogModules = [],
  catalogExceptions = [],
} = {}) {
  const files = new Map(Object.entries(repository));
  for (const { file, source } of [...guidanceFiles, ...documents]) files.set(file, source);
  for (const file of catalogModules) files.set(file, "");
  return {
    guidance: guidanceFiles,
    featureMapDocuments: documents,
    featureMapIndex: "docs/feature-map/README.md",
    capabilityGuide: "docs/feature-map/how-to-add.md",
    providerCatalogMigrationFiles: catalogModules,
    providerCatalogModuleExceptions: catalogExceptions,
    readRepositoryFile: (file) => (files.has(file) ? files.get(file) : null),
  };
}

function identities(findings) {
  return findings.map(({ id, file }) => ({ id, file }));
}

test("identical marked reuse sections produce no finding", () => {
  assert.deepEqual(reuseFindings(inputs()), { blocking: [], advisory: [] });
});

test("a one-word difference between the marked reuse sections blocks", () => {
  const { blocking } = reuseFindings(inputs({
    guidanceFiles: guidance(reuseSection, reuseSection.replace("existing", "current")),
  }));
  assert.deepEqual(identities(blocking), [
    { id: "guidance/reuse-section-differs", file: "CLAUDE.md" },
  ]);
});

test("a missing reuse marker blocks for the file that lacks it", () => {
  const withoutEnd = reuseSection.replace("<!-- reuse-rule:end -->", "");
  const { blocking } = reuseFindings(inputs({ guidanceFiles: guidance(withoutEnd, reuseSection) }));
  assert.deepEqual(identities(blocking), [
    { id: "guidance/reuse-marker-missing", file: "AGENTS.md" },
  ]);
});

test("a file with no reuse section at all blocks", () => {
  const { blocking } = reuseFindings(inputs({ guidanceFiles: guidance(reuseSection, "") }));
  assert.deepEqual(identities(blocking), [
    { id: "guidance/reuse-marker-missing", file: "CLAUDE.md" },
  ]);
});

const index = {
  file: "docs/feature-map/README.md",
  source: "# Feature map\n\n- [Guide](how-to-add.md)\n",
};

test("a valid file link and a valid anchor produce no finding", () => {
  const guide = {
    file: "docs/feature-map/how-to-add.md",
    source: [
      "# How to add",
      "",
      "See [the registry](../../src/catalog_registry.rs), [rules](../../CLAUDE.md#database-backed-graphql-models--governing-rules),",
      "[the `TypedTool` step](#adding-a-typedtool-step) and [external](https://example.com/missing).",
      "",
      "## Adding a `TypedTool` step",
      "",
      "```rust",
      "// [not a link](missing.rs)",
      "```",
    ].join("\n"),
  };
  const guidanceFiles = guidance();
  guidanceFiles[1].source += "\n## Database-backed GraphQL Models — governing rules\n";
  assert.deepEqual(reuseFindings(inputs({
    guidanceFiles,
    documents: [index, guide],
    repository: { "src/catalog_registry.rs": "pub fn registry() {}" },
  })), { blocking: [], advisory: [] });
});

test("a relative link to a missing file blocks", () => {
  const guide = {
    file: "docs/feature-map/how-to-add.md",
    source: "# How to add\n\nUse [the old dispatcher](../../src/dispatch.rs).\n",
  };
  const { blocking } = reuseFindings(inputs({ documents: [index, guide] }));
  assert.deepEqual(identities(blocking), [
    { id: "links/missing-file", file: "docs/feature-map/how-to-add.md" },
  ]);
  assert.equal(blocking[0].line, 3);
});

test("a link whose label nests brackets and emphasis still blocks on a missing file", () => {
  const guide = {
    file: "docs/feature-map/how-to-add.md",
    source: "# How to add\n\nUse [nested **words [like these]**](../../missing.rs).\n",
  };
  const { blocking } = reuseFindings(inputs({ documents: [index, guide] }));
  assert.deepEqual(identities(blocking), [
    { id: "links/missing-file", file: "docs/feature-map/how-to-add.md" },
  ]);
  assert.equal(blocking[0].line, 3);
});

test("an anchor to a setext heading produces no finding", () => {
  const guide = {
    file: "docs/feature-map/how-to-add.md",
    source: "# How to add\n\nSee [examples](valid.md#examples).\n",
  };
  const valid = {
    file: "docs/feature-map/valid.md",
    source: "Examples\n========\n\nA worked example.\n",
  };
  assert.deepEqual(reuseFindings(inputs({
    documents: [{ ...index, source: `${index.source}- [Valid](valid.md)\n` }, guide, valid],
  })), { blocking: [], advisory: [] });
});

test("a link to a missing anchor blocks, in the same file or another file", () => {
  const guide = {
    file: "docs/feature-map/how-to-add.md",
    source: [
      "# How to add",
      "",
      "See [the step](#a-removed-step).",
      "See [the rules](../../CLAUDE.md#retired-rules).",
    ].join("\n"),
  };
  const { blocking } = reuseFindings(inputs({ documents: [index, guide] }));
  assert.deepEqual(identities(blocking), [
    { id: "links/missing-anchor", file: "docs/feature-map/how-to-add.md" },
    { id: "links/missing-anchor", file: "docs/feature-map/how-to-add.md" },
  ]);
  assert.deepEqual(blocking.map(({ line }) => line), [3, 4]);
});

test("a feature-map document the index does not list is advisory only", () => {
  const guide = { file: "docs/feature-map/how-to-add.md", source: "# How to add\n" };
  const settings = { file: "docs/feature-map/settings.md", source: "# Settings\n" };
  const findings = reuseFindings(inputs({ documents: [index, guide, settings] }));
  assert.deepEqual(findings.blocking, []);
  assert.deepEqual(identities(findings.advisory), [
    { id: "feature-map/unindexed-document", file: "docs/feature-map/settings.md" },
  ]);
});

function capabilityGuide(rows) {
  return {
    file: "docs/feature-map/how-to-add.md",
    source: [
      "# How to add",
      "",
      "| Task | Status | Closest working example | Details |",
      "| --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
  };
}

const ownerSpecs = {
  "docs/plans/CODING-2727-contracts-spec.md": "# CODING-2727\n",
  "docs/plans/CODING-2729-editor-spec.md": "# CODING-2729\n",
};

test("Proposed capability paths that link their owning Story produce no finding", () => {
  const guide = capabilityGuide([
    "| Setting | Supported now | `example.rs`. Shared save is Proposed in [CODING-2729](../plans/CODING-2729-editor-spec.md) | None |",
    "| Contracts | Proposed: [CODING-2727](../plans/CODING-2727-contracts-spec.md) | Current pattern | [Owning Story spec](../plans/CODING-2727-contracts-spec.md) |",
    "| MCP tool | Transitional until CODING-2746 | None | None |",
  ]);
  assert.deepEqual(reuseFindings(inputs({ documents: [index, guide], repository: ownerSpecs })),
    { blocking: [], advisory: [] });
});

test("a Proposed capability path whose owning Story is plain text blocks", () => {
  const guide = capabilityGuide([
    "| Setting | Supported now | `example.rs`. Shared save is Proposed in CODING-2729 | None |",
    "| Contracts | Proposed: CODING-2727 | Current pattern | Owning Story CODING-2727 |",
  ]);
  const { blocking } = reuseFindings(inputs({ documents: [index, guide], repository: ownerSpecs }));
  assert.deepEqual(identities(blocking), [
    { id: "capability-guide/unlinked-owner", file: "docs/feature-map/how-to-add.md" },
    { id: "capability-guide/unlinked-owner", file: "docs/feature-map/how-to-add.md" },
  ]);
  assert.deepEqual(blocking.map(({ line }) => line), [5, 6]);
  assert.match(blocking[0].message, /CODING-2729/);
  assert.match(blocking[1].message, /CODING-2727/);
});

test("a Proposed capability path that links a file not naming its owner blocks", () => {
  const guide = capabilityGuide([
    "| Contracts | Proposed: CODING-2727 | Current pattern | [Owning Story](../plans/CODING-2729-editor-spec.md) |",
  ]);
  const { blocking } = reuseFindings(inputs({ documents: [index, guide], repository: ownerSpecs }));
  assert.deepEqual(identities(blocking), [
    { id: "capability-guide/unlinked-owner", file: "docs/feature-map/how-to-add.md" },
  ]);
});

const catalogFolder = "studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations";

test("a new per-model provider-catalog module blocks and points to the registry how-to", () => {
  const { blocking } = reuseFindings(inputs({
    catalogModules: [`${catalogFolder}/mod.rs`, `${catalogFolder}/codex_7_nova.rs`],
  }));
  assert.deepEqual(identities(blocking), [
    { id: "provider-catalog/per-model-module", file: `${catalogFolder}/codex_7_nova.rs` },
  ]);
  assert.match(blocking[0].message, /docs\/feature-map\/settings\.md#add-a-model-or-change-its-reasoning-levels/);
});

test("catalog modules, files nested under catalog folders, test modules and the ledger produce no finding", () => {
  assert.deepEqual(reuseFindings(inputs({
    catalogModules: [
      `${catalogFolder}/catalog_registry.rs`,
      `${catalogFolder}/catalog_runner/tests.rs`,
      `${catalogFolder}/catalog_runner/fixtures/codex_7_nova.rs`,
      `${catalogFolder}/historical_installs_tests.rs`,
      `${catalogFolder}/ledger.rs`,
      `${catalogFolder}/mod.rs`,
    ],
  })), { blocking: [], advisory: [] });
});

test("a module listed in the exception registry is silent", () => {
  assert.deepEqual(reuseFindings(inputs({
    catalogModules: [`${catalogFolder}/codex_6_astra.rs`],
    catalogExceptions: [{ file: `${catalogFolder}/codex_6_astra.rs`, reason: "Keeps the row id." }],
  })), { blocking: [], advisory: [] });
});

test("an exception entry whose file no longer exists blocks", () => {
  const { blocking } = reuseFindings(inputs({
    catalogModules: [`${catalogFolder}/mod.rs`],
    catalogExceptions: [{ file: `${catalogFolder}/codex_6_astra.rs`, reason: "Keeps the row id." }],
  }));
  assert.deepEqual(identities(blocking), [
    { id: "provider-catalog/stale-exception", file: `${catalogFolder}/codex_6_astra.rs` },
  ]);
});
