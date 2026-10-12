import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { providerCatalogModuleExceptions } from "./reuse-gate/provider-catalog-exceptions.mjs";

const cli = fileURLToPath(new URL("./reuse-check.mjs", import.meta.url));
const baselineCli = fileURLToPath(new URL("./reuse-baseline.mjs", import.meta.url));
const reuseSection = "<!-- reuse-rule:start -->\nAsk what already does this.\n<!-- reuse-rule:end -->\n";

function fixtureRepository(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-check-"));
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
  return root;
}

function runGate(root) {
  return spawnSync(process.execPath, [cli, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "true" },
  });
}

const advisoryOnly = {
  "AGENTS.md": `# Agents\n\n${reuseSection}`,
  "CLAUDE.md": `# Claude\n\n${reuseSection}`,
  "docs/feature-map/README.md": "# Feature map\n\n- [Guide](how-to-add.md)\n",
  "docs/feature-map/how-to-add.md": "# How to add\n\nSee [settings](settings.md#models).\n",
  "docs/feature-map/settings.md": "# Settings\n\n## Models\n",
  ...Object.fromEntries(providerCatalogModuleExceptions.map(({ file }) => [file, "// excepted\n"])),
};

test("exits 0 and annotates a warning when every finding is advisory", () => {
  const result = runGate(fixtureRepository(advisoryOnly));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /::warning file=docs\/feature-map\/settings\.md::feature-map\/unindexed-document/);
  assert.doesNotMatch(result.stdout, /::error/);
});

test("exits non-zero and annotates an error when a finding blocks", () => {
  const result = runGate(fixtureRepository({
    ...advisoryOnly,
    "docs/feature-map/how-to-add.md": "# How to add\n\nSee [settings](settings.md#retired).\n",
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /::error file=docs\/feature-map\/how-to-add\.md,line=3::links\/missing-anchor/);
});

const duplicatedFunction = `export function summarise(rows: { name: string; total: number }[]) {
  const totals = rows.map((row) => row.total).filter((total) => total > 0);
  const largest = totals.reduce((best, total) => Math.max(best, total), 0);
  const names = rows.filter((row) => row.total === largest).map((row) => row.name);
  return { count: totals.length, largest, names: names.sort().join(", ") };
}
`;

test("a new duplicated-code clone is a warning and never fails the gate", () => {
  const result = runGate(fixtureRepository({
    ...advisoryOnly,
    "docs/feature-map/README.md": "# Feature map\n\n- [Guide](how-to-add.md)\n- [Settings](settings.md)\n",
    "studio/src/features/a/summary.ts": `// a\n${duplicatedFunction}`,
    "studio/src/features/b/summary.ts": `// b\n\n\n${duplicatedFunction}`,
    "scripts/reuse-gate/duplication/baseline.json": "[]\n",
  }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /::warning file=studio\/src\/features\/a\/summary\.ts,line=\d+::duplication\/new-clone/);
  assert.match(result.stdout, /studio\/src\/features\/b\/summary\.ts/);
});

test("reuse:baseline records current clones deterministically and silences them", () => {
  const root = fixtureRepository({
    ...advisoryOnly,
    "docs/feature-map/README.md": "# Feature map\n\n- [Guide](how-to-add.md)\n- [Settings](settings.md)\n",
    "studio/src/features/a/summary.ts": duplicatedFunction,
    "studio/src/features/b/summary.ts": duplicatedFunction,
    "studio/src/features/generated/summary.ts": duplicatedFunction,
  });
  const refresh = () => spawnSync(process.execPath, [baselineCli, "--root", root], { encoding: "utf8" });
  const baselinePath = path.join(root, "scripts/reuse-gate/duplication/baseline.json");
  assert.equal(refresh().status, 0);
  const first = fs.readFileSync(baselinePath, "utf8");
  assert.equal(refresh().status, 0);
  assert.equal(fs.readFileSync(baselinePath, "utf8"), first);
  assert.doesNotMatch(first, /generated/);
  assert.doesNotMatch(first, /startLine|endLine|"line"/);
  const result = runGate(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /duplication\//);
});

test("the CI fast-gate step runs these reuse gate tests", () => {
  const workflow = fs.readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");
  const step = workflow.split(/\n\s+- name: /).find((block) => block.startsWith("Reuse and boundary gates\n"));
  assert.ok(step, "ci.yml has no 'Reuse and boundary gates' step");
  const commands = step.split("\n").map((line) => line.trim());
  assert.ok(commands.includes("npm run reuse:test"), step);
});
