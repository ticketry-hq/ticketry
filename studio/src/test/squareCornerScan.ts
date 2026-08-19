// T674: the square-corners guard used to be a bare lexical scan, so the English
// word "rounded" in a comment, an identifier, or a user-facing string failed a
// gate whose message named a Tailwind utility that was not there. This module
// narrows the scan to the styling context the rule actually polices:
//
//   * a `rounded` token only counts inside a string literal — never in a
//     comment or an identifier — and the bare word additionally requires a
//     `className` / `class` / `@apply` context, because only a suffixed
//     utility (`rounded-md`, `rounded-[4px]`, `hover:rounded`) is unambiguous
//     outside one;
//   * a radius declaration is a violation only when the value is not flat, so
//     `0`, `0px` and `0 0 0 0` all pass where only the literal `0` used to.

export interface CornerFinding {
  readonly line: number;
  readonly text: string;
}

const RADIUS_SIDE = "t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee";
const RADIUS_SCALE = "none|sm|md|lg|xl|2xl|3xl|4xl|full";
// `hover:`, `md:`, `group-focus:` … then `rounded`, an optional side, and an
// optional scale or arbitrary value. Anything else is not a radius utility.
const ROUNDED_UTILITY = new RegExp(
  `^!?-?(?:[a-z0-9@_-]+(?:\\[[^\\]]*\\])?:)*rounded` +
    `(?:-(?:${RADIUS_SIDE}))?` +
    `(?:-(?:${RADIUS_SCALE}|\\[[^\\]]*\\]))?$`,
);
const BARE_ROUNDED = /^!?-?(?:[a-z0-9@_-]+(?:\[[^\]]*\])?:)*rounded$/;

const ZERO_LENGTH = /^[+-]?0(?:\.0+)?(?:px|rem|em|%|vh|vw|vmin|vmax|pt|pc|in|cm|mm|ch|ex|q)?$/i;

interface StringLiteral {
  readonly content: string;
  readonly start: number;
}

interface Region {
  readonly start: number;
  readonly end: number;
}

/**
 * Blanks comments (keeping offsets stable) and collects every string literal.
 * Template literals are captured whole; interpolated class strings inside them
 * survive as quoted tokens, which token normalisation strips.
 */
function readSource(source: string): {
  readonly code: string;
  readonly literals: StringLiteral[];
} {
  const code = source.split("");
  const literals: StringLiteral[] = [];
  const blank = (from: number, to: number) => {
    for (let index = from; index < to; index += 1) {
      if (code[index] !== "\n") code[index] = " ";
    }
  };

  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    const next = source[cursor + 1];

    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", cursor);
      blank(cursor, end === -1 ? source.length : end);
      cursor = end === -1 ? source.length : end;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", cursor + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(cursor, stop);
      cursor = stop;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const start = cursor + 1;
      let index = start;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === character) break;
        if (character !== "`" && source[index] === "\n") break;
        index += 1;
      }
      literals.push({ content: source.slice(start, Math.min(index, source.length)), start });
      cursor = Math.min(index, source.length) + 1;
      continue;
    }
    cursor += 1;
  }

  return { code: code.join(""), literals };
}

function matchingBrace(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    else if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return code.length;
}

function closingQuote(code: string, open: number): number {
  const quote = code[open];
  for (let index = open + 1; index < code.length; index += 1) {
    if (code[index] === "\\") {
      index += 1;
      continue;
    }
    if (code[index] === quote) return index;
    if (quote !== "`" && code[index] === "\n") return index;
  }
  return code.length;
}

/** Character ranges that carry class names: `class`/`className` values and `@apply` rules. */
function stylingRegions(code: string): Region[] {
  const regions: Region[] = [];

  for (const match of code.matchAll(/@apply\b/g)) {
    const start = match.index + match[0].length;
    const semicolon = code.indexOf(";", start);
    const newline = code.indexOf("\n", start);
    const candidates = [semicolon, newline].filter((index) => index !== -1);
    regions.push({ start, end: candidates.length ? Math.min(...candidates) : code.length });
  }

  for (const match of code.matchAll(/\b(?:className|class)\s*[:=]/g)) {
    let start = match.index + match[0].length;
    while (start < code.length && /\s/.test(code[start])) start += 1;
    const opener = code[start];
    if (opener === "{") regions.push({ start, end: matchingBrace(code, start) + 1 });
    else if (opener === '"' || opener === "'" || opener === "`") {
      regions.push({ start, end: closingQuote(code, start) + 1 });
    }
  }

  return regions;
}

const lineAt = (source: string, index: number): number =>
  source.slice(0, index).split("\n").length;

/** Strips the punctuation that survives when a nested literal is split on whitespace. */
const normaliseToken = (token: string): string =>
  token.replace(/^[`'"({?:,;]+/, "").replace(/[`'"),;:?}]+$/, "");

export function findRoundedUtilities(source: string): CornerFinding[] {
  const { code, literals } = readSource(source);
  const regions = stylingRegions(code);
  const inStylingContext = (index: number) =>
    regions.some((region) => index >= region.start && index < region.end);

  const findings: CornerFinding[] = [];
  const report = (index: number, token: string) => {
    findings.push({ line: lineAt(source, index), text: token });
  };

  // `@apply` bodies are raw class lists, not string literals.
  for (const region of regions) {
    if (!code.slice(Math.max(0, region.start - 8), region.start).includes("@apply")) continue;
    for (const match of code.slice(region.start, region.end).matchAll(/\S+/g)) {
      const token = normaliseToken(match[0]);
      if (ROUNDED_UTILITY.test(token)) report(region.start + match.index, token);
    }
  }

  for (const literal of literals) {
    const styling = inStylingContext(literal.start);
    for (const match of literal.content.matchAll(/\S+/g)) {
      const token = normaliseToken(match[0]);
      if (!ROUNDED_UTILITY.test(token)) continue;
      // Outside a styling context only an unambiguous utility counts; the bare
      // word is ordinary English and may appear in any user-facing string.
      if (!styling && BARE_ROUNDED.test(token)) continue;
      report(literal.start + match.index, token);
    }
  }

  return findings.sort((left, right) => left.line - right.line);
}

const isFlatRadius = (value: string): boolean => {
  const cleaned = value
    .replace(/!important/gi, "")
    .replace(/[`'"]/g, "")
    .replace(/[,)}]+\s*$/, "")
    .trim();
  if (!cleaned) return false;
  return cleaned
    .split(/[\s/]+/)
    .every((component) => ZERO_LENGTH.test(component));
};

export function findNonZeroRadii(source: string): CornerFinding[] {
  const { code } = readSource(source);
  const findings: CornerFinding[] = [];

  for (const match of code.matchAll(
    /(?:border(?:-[a-z]+)*-radius|borderRadius)\s*[:=]([^;\n]*)/g,
  )) {
    if (isFlatRadius(match[1])) continue;
    findings.push({ line: lineAt(source, match.index), text: match[0].trim() });
  }

  return findings;
}
