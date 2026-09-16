/** Parsed evidence block from a finding's description (CODIN-905 format). */
export interface FindingLocation {
  path: string;
  lineStart: number;
  lineEnd: number;
}

// Parse the fixed `Path:` / `Lines: start-end` block CODIN-905 writes into the
// finding's canonical description. There is no structured
// location field on the WorkItem, so the panel reads it back out of the text.
// Returns null when either line is absent or malformed — the panel then simply
// omits the location rather than showing a broken one.
export function parseFindingLocation(
  description: string | null | undefined,
): FindingLocation | null {
  if (!description) return null;
  const pathMatch = description.match(/^\s*Path:\s*(.+?)\s*$/m);
  const linesMatch = description.match(/^\s*Lines:\s*(\d+)\s*-\s*(\d+)\s*$/m);
  if (!pathMatch || !linesMatch) return null;
  const lineStart = Number(linesMatch[1]);
  const lineEnd = Number(linesMatch[2]);
  if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null;
  return { path: pathMatch[1], lineStart, lineEnd };
}

/** Compact "path:start-end" label for a finding row; null when unparseable. */
export function formatFindingLocation(
  description: string | null | undefined,
): string | null {
  const loc = parseFindingLocation(description);
  if (!loc) return null;
  return `${loc.path}:${loc.lineStart}-${loc.lineEnd}`;
}
