// Markdown reading for the reuse gate: links and GitHub heading slugs, taken
// from the studio's `marked` tokenizer. Code blocks and code spans yield no
// links because the tokenizer never produces link tokens inside them.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// The studio workspace owns `marked`; resolve it there so npm and pnpm
// installs both find it.
const studioRequire = createRequire(new URL("../../studio/package.json", import.meta.url));
const { Lexer } = await import(pathToFileURL(studioRequire.resolve("marked")).href);

function childTokens(token) {
  if (token.type === "table") return [...token.header, ...token.rows.flat()].flatMap((cell) => cell.tokens);
  return token.tokens ?? token.items ?? [];
}

/** Visits every token with the 1-based source line its `raw` text starts on. */
function visitTokens(source, visit) {
  const text = source.replace(/\r\n?/g, "\n");
  let cursor = 0;
  const lineAt = (offset) => text.slice(0, offset).split("\n").length;
  const walk = (tokens) => {
    for (const token of tokens) {
      const found = token.raw ? text.indexOf(token.raw, cursor) : -1;
      if (found !== -1) cursor = found;
      visit(token, lineAt(cursor));
      walk(childTokens(token));
      if (found !== -1) cursor = Math.max(cursor, found + token.raw.length);
    }
  };
  walk(Lexer.lex(text));
}

/** Returns `{ target, line }` for each inline link, image and reference definition. */
export function markdownLinks(source) {
  const links = [];
  visitTokens(source, (token, line) => {
    const inline = (token.type === "link" || token.type === "image") && token.raw.endsWith(")");
    if (inline || token.type === "def") links.push({ target: token.href, line });
  });
  return links;
}

function plainText(token) {
  if (token.type === "html") return "";
  return token.tokens ? token.tokens.map(plainText).join("") : (token.text ?? "");
}

/** GitHub-style heading anchors, including `-1`, `-2` suffixes for repeats. */
export function headingSlugs(source) {
  const slugs = new Set();
  const counts = new Map();
  visitTokens(source, (token) => {
    if (token.type !== "heading") return;
    const base = plainText(token)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .replace(/ /g, "-");
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
  });
  return slugs;
}

function linkTargets(tokens) {
  return tokens.flatMap((token) => [
    ...(token.type === "link" ? [token.href] : []),
    ...linkTargets(token.tokens ?? []),
  ]);
}

/** Table body rows as `{ line, cells: [{ text, links }] }`; `text` drops link targets. */
export function markdownTableRows(source) {
  const rows = [];
  visitTokens(source, (token, line) => {
    if (token.type !== "table") return;
    token.rows.forEach((cells, index) => rows.push({
      line: line + 2 + index,
      cells: cells.map((cell) => ({ text: cell.tokens.map(plainText).join(""), links: linkTargets(cell.tokens) })),
    }));
  });
  return rows;
}
