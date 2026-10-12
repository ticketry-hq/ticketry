// `npm run reuse:baseline`: rewrites the committed duplication baseline from
// the current clones. Accepting repetition is a reviewed decision, so review
// the baseline diff like code.
import { fileURLToPath } from "node:url";

import { baselineFile, cloneBaseline, writeBaseline } from "./reuse-gate/duplication/baseline.mjs";
import { withoutIgnoredPaths } from "./reuse-gate/duplication/ignored-paths.mjs";
import { scanClones } from "./reuse-gate/duplication/jscpd-scan.mjs";
import { ignoredPaths } from "./reuse-gate/duplication/scan-config.mjs";
import { repositoryRoot } from "./reuse-check.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = repositoryRoot(process.argv);
  const entries = cloneBaseline(withoutIgnoredPaths(scanClones(root), ignoredPaths));
  writeBaseline(root, entries);
  console.log(`reuse:baseline: wrote ${entries.length} clones to ${baselineFile}`);
}
