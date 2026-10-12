import manifest from "../../../../config/editions.json" with { type: "json" };

/** Every edition a build can compile, from the product edition manifest. */
export const knownEditions = Object.freeze([...manifest.editions]);

/**
 * Parse an entry's `Editions:` declaration: exactly one line, directly after
 * `Surfaces:`, naming one or more distinct known editions. `editions` is null
 * whenever any problem is reported.
 */
export function entryEditions(source) {
  const lines = source.split(/\r?\n/);
  const declarations = lines.flatMap((line, index) => /^Editions:/.test(line) ? [{ line, index }] : []);
  const problems = [];
  if (declarations.length === 0) return { editions: null, problems: ["missing Editions: line"] };
  if (declarations.length > 1) problems.push(`extra Editions: lines (${declarations.length})`);
  const [{ line, index }] = declarations;
  if (!/^Surfaces:/.test(lines[index - 1] ?? "")) problems.push("Editions: line must directly follow Surfaces:");
  const values = line.slice("Editions:".length).trim().split(/\s*,\s*/).filter(Boolean);
  if (!values.length) problems.push("empty Editions: line");
  for (const value of values) if (!knownEditions.includes(value)) problems.push(`illegal edition ${JSON.stringify(value)}; expected ${knownEditions.join(" and/or ")}`);
  for (const value of new Set(values)) if (values.filter((item) => item === value).length > 1) problems.push(`duplicate edition ${value}`);
  return { editions: problems.length ? null : values, problems };
}
