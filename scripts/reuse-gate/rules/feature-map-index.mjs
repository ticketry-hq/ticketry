import path from "node:path";

import { markdownLinks } from "../markdown.mjs";

// The feature-map index should list every feature-map document. A missing
// entry is advisory: the document still works, it is just harder to find.
export function featureMapIndexFindings({ featureMapDocuments, featureMapIndex }) {
  const index = featureMapDocuments.find(({ file }) => file === featureMapIndex);
  const listed = new Set((index ? markdownLinks(index.source) : []).map(({ target }) =>
    path.posix.join(path.posix.dirname(featureMapIndex), target.split("#")[0])));
  const advisory = featureMapDocuments
    .filter(({ file }) => file !== featureMapIndex && !listed.has(file))
    .map(({ file }) => ({
      id: "feature-map/unindexed-document",
      file,
      message: `list this document in ${featureMapIndex}`,
    }));
  return { advisory };
}
