import assert from "node:assert/strict";
import test from "node:test";

import { cloneBaseline } from "./duplication/baseline.mjs";
import { reuseFindings } from "./findings.mjs";

const reuseSection = "<!-- reuse-rule:start -->\nAsk what already does this.\n<!-- reuse-rule:end -->\n";

const fragment = [
  "let root = tempfile::tempdir().unwrap();",
  "let first = root.path().join(\"first\");",
  "std::fs::create_dir(&first).unwrap();",
].join("\n");

function clone({ first = "crates/a/src/trust.rs", second = "crates/b/tests/trust.rs", at = 10, text = fragment } = {}) {
  return {
    tokens: 88,
    lines: 7,
    fragment: text,
    first: { file: first, startLine: at, endLine: at + 6 },
    second: { file: second, startLine: at + 40, endLine: at + 46 },
  };
}

function inputs({ clones = [], baseline = [], ignore = [] } = {}) {
  const guidance = [
    { file: "AGENTS.md", source: `# Agents\n\n${reuseSection}` },
    { file: "CLAUDE.md", source: `# Claude\n\n${reuseSection}` },
  ];
  return {
    guidance,
    featureMapDocuments: [],
    featureMapIndex: "docs/feature-map/README.md",
    readRepositoryFile: () => null,
    duplication: { clones, baseline, ignore },
  };
}

test("a clone absent from the baseline produces one advisory finding naming both locations", () => {
  const { blocking, advisory } = reuseFindings(inputs({ clones: [clone()] }));
  assert.deepEqual(blocking, []);
  assert.equal(advisory.length, 1);
  assert.equal(advisory[0].id, "duplication/new-clone");
  assert.equal(advisory[0].file, "crates/a/src/trust.rs");
  assert.equal(advisory[0].line, 10);
  assert.match(advisory[0].message, /crates\/a\/src\/trust\.rs:10-16/);
  assert.match(advisory[0].message, /crates\/b\/tests\/trust\.rs:50-56/);
  assert.match(advisory[0].message, /88 tokens/);
  assert.match(advisory[0].message, /how-to-add-a-capability\.md/);
});

test("a clone inside an ignored generated path produces no finding", () => {
  const ignore = [{ pattern: "studio/src/features/*/generated/**", reason: "typed GraphQL documents" }];
  const generated = clone({
    first: "studio/src/features/sprints/generated/sprints.documents.ts",
    second: "studio/src/features/projects/generated/projects.documents.ts",
  });
  assert.deepEqual(reuseFindings(inputs({ clones: [generated], ignore })), { blocking: [], advisory: [] });
});

test("a baselined clone stays silent after its line numbers shift", () => {
  const baseline = cloneBaseline([clone({ at: 10 })]);
  const shifted = clone({ at: 210, text: `  ${fragment.replaceAll("\n", "\n    ")}  ` });
  assert.deepEqual(reuseFindings(inputs({ clones: [shifted], baseline })), { blocking: [], advisory: [] });
});

test("a baseline entry with no current clone produces a stale advisory", () => {
  const baseline = cloneBaseline([clone()]);
  const { blocking, advisory } = reuseFindings(inputs({ baseline }));
  assert.deepEqual(blocking, []);
  assert.deepEqual(advisory.map(({ id, file }) => ({ id, file })), [
    { id: "duplication/stale-baseline-entry", file: "scripts/reuse-gate/duplication/baseline.json" },
  ]);
  assert.match(advisory[0].message, /crates\/a\/src\/trust\.rs/);
  assert.match(advisory[0].message, /crates\/b\/tests\/trust\.rs/);
  assert.match(advisory[0].message, /npm run reuse:baseline/);
});
