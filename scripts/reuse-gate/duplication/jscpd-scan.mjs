// Runs jscpd over the scan roots and returns clones with repository-relative
// paths, in the shape the duplication rule reads.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { ignoredPaths, minimumTokens, scanFormats, scanRoots } from "./scan-config.mjs";

const jscpd = createRequire(import.meta.url).resolve("jscpd/run-jscpd.js");

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function side(root, { name, start, end }) {
  return { file: relative(root, name), startLine: start, endLine: end };
}

export function scanClones(repositoryRoot) {
  // jscpd reports real paths, so compare against the real root (macOS /var → /private/var).
  const root = fs.realpathSync(repositoryRoot);
  const roots = scanRoots.map((scanRoot) => path.join(root, scanRoot)).filter((scanRoot) => fs.existsSync(scanRoot));
  if (roots.length === 0) return [];
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-jscpd-"));
  try {
    const result = spawnSync(process.execPath, [
      jscpd,
      "--format", scanFormats.join(","),
      "--min-tokens", String(minimumTokens),
      "--ignore", ignoredPaths.map(({ pattern }) => pattern.startsWith("**/") ? pattern : `${root}/${pattern}`).join(","),
      "--reporters", "json",
      "--output", output,
      "--absolute",
      "--workers", "1",
      "--silent",
      ...roots,
    ], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`jscpd failed: ${result.stderr || result.stdout}`);
    const report = JSON.parse(fs.readFileSync(path.join(output, "jscpd-report.json"), "utf8"));
    return report.duplicates.map((duplicate) => ({
      tokens: duplicate.tokens,
      lines: duplicate.lines,
      fragment: duplicate.fragment,
      first: side(root, duplicate.firstFile),
      second: side(root, duplicate.secondFile),
    }));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}
