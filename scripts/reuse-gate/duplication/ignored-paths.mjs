// `**` spans directories, `*` stays within one path segment.
function globExpression(pattern) {
  const source = pattern.split(/(\*\*\/?|\*)/).map((part) => {
    if (part === "**/") return "(?:.*/)?";
    if (part === "**") return ".*";
    if (part === "*") return "[^/]*";
    return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${source}$`);
}

/** Drops every clone with either side under an ignored repository-relative glob. */
export function withoutIgnoredPaths(clones, ignore) {
  const ignored = ignore.map(({ pattern }) => globExpression(pattern));
  const isIgnored = (file) => ignored.some((expression) => expression.test(file));
  return clones.filter(({ first, second }) => !isIgnored(first.file) && !isIgnored(second.file));
}
