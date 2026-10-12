import { baselineFile, cloneIdentity, identityKey } from "../duplication/baseline.mjs";
import { withoutIgnoredPaths } from "../duplication/ignored-paths.mjs";

const capabilityGuide = "docs/feature-map/how-to-add-a-capability.md";

function location({ file, startLine, endLine }) {
  return `${file}:${startLine}-${endLine}`;
}

// Duplicated code is advisory: a scanner finds repeated syntax, not repeated
// responsibility, so a new clone starts a reuse discussion and never blocks.
export function duplicationBaselineFindings({ duplication }) {
  if (!duplication) return {};
  const current = withoutIgnoredPaths(duplication.clones, duplication.ignore);
  const baselined = new Set(duplication.baseline.map(identityKey));
  const currentKeys = new Set(current.map((clone) => identityKey(cloneIdentity(clone))));
  const newClones = current
    .filter((clone) => !baselined.has(identityKey(cloneIdentity(clone))))
    .map((clone) => ({
      id: "duplication/new-clone",
      file: clone.first.file,
      line: clone.first.startLine,
      message: `new duplicated code (${clone.tokens} tokens, ${clone.lines} lines) between `
        + `${location(clone.first)} and ${location(clone.second)}; check ${capabilityGuide} `
        + "for an existing module or discuss reuse before keeping both",
    }));
  const staleEntries = duplication.baseline
    .filter((entry) => !currentKeys.has(identityKey(entry)))
    .map(({ files, fragmentHash }) => ({
      id: "duplication/stale-baseline-entry",
      file: baselineFile,
      message: `baselined clone ${fragmentHash} between ${files.join(" and ")} no longer exists; `
        + "run npm run reuse:baseline and review the diff",
    }));
  const advisory = [...newClones, ...staleEntries];
  return { advisory };
}
