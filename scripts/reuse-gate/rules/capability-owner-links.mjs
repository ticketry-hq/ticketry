import path from "node:path";

import { markdownTableRows } from "../markdown.mjs";

// A Proposed path in the capability guide cannot be used yet, so the row must
// link the owning Story (a document whose file name carries the Story key) for
// its decisions and current fallback. Plain-text Story keys block.
const storyKey = /\b[A-Z][A-Z0-9]*-\d+\b/g;

export function capabilityOwnerLinkFindings({ featureMapDocuments, capabilityGuide }) {
  const guide = featureMapDocuments.find(({ file }) => file === capabilityGuide);
  if (!guide) return { blocking: [] };
  const blocking = [];
  for (const { line, cells } of markdownTableRows(guide.source)) {
    const linkedFiles = cells.flatMap(({ links }) => links)
      .map((target) => path.posix.basename(target.split("#")[0]));
    const owners = new Set(cells
      .filter(({ text }) => /\bProposed\b/.test(text))
      .flatMap(({ text }) => text.match(storyKey) ?? []));
    for (const owner of owners) {
      if (linkedFiles.some((file) => file.includes(owner))) continue;
      blocking.push({
        id: "capability-guide/unlinked-owner",
        file: guide.file,
        line,
        message: `${owner} owns a Proposed path; link its Story spec (a file named for ${owner})`,
      });
    }
  }
  return { blocking };
}
