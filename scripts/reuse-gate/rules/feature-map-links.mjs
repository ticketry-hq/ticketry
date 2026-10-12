import path from "node:path";

import { headingSlugs, markdownLinks } from "../markdown.mjs";

// Every relative link in the feature map must resolve inside the repository,
// and a `#anchor` must match a heading slug in the target Markdown file.
// External URLs are never fetched.
const externalTarget = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function resolveTarget(file, rawPath) {
  if (rawPath === "") return file;
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(file), decodeURIComponent(rawPath)),
  ).replace(/\/$/, "");
}

export function featureMapLinkFindings({ featureMapDocuments, readRepositoryFile }) {
  const blocking = [];
  for (const { file, source } of featureMapDocuments) {
    for (const { target, line } of markdownLinks(source)) {
      if (externalTarget.test(target)) continue;
      const hashAt = target.indexOf("#");
      const rawPath = hashAt === -1 ? target : target.slice(0, hashAt);
      const anchor = hashAt === -1 ? null : decodeURIComponent(target.slice(hashAt + 1));
      const resolved = resolveTarget(file, rawPath);
      const content = resolved.startsWith("..") ? null : readRepositoryFile(resolved);
      if (content === null) {
        blocking.push({
          id: "links/missing-file",
          file,
          line,
          message: `${target} does not resolve to a repository file`,
        });
      } else if (anchor && !(/\.md$/i.test(resolved) && headingSlugs(content).has(anchor))) {
        blocking.push({
          id: "links/missing-anchor",
          file,
          line,
          message: `${target} names no heading in ${resolved}`,
        });
      }
    }
  }
  return { blocking };
}
