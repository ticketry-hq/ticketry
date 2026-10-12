// AGENTS.md and CLAUDE.md each carry the shared reuse rule between these
// markers. Only the marked section must match; the rest of the files may differ.
const startMarker = "<!-- reuse-rule:start -->";
const endMarker = "<!-- reuse-rule:end -->";

function occurrences(source, marker) {
  return source.split(marker).length - 1;
}

// Returns the trimmed section text, or null unless exactly one ordered pair exists.
function markedSection(source) {
  if (occurrences(source, startMarker) !== 1 || occurrences(source, endMarker) !== 1) return null;
  const start = source.indexOf(startMarker) + startMarker.length;
  const end = source.indexOf(endMarker);
  return start <= end ? source.slice(start, end).trim() : null;
}

export function guidanceConsistencyFindings({ guidance }) {
  const blocking = [];
  const sections = guidance.map(({ file, source }) => ({ file, section: markedSection(source) }));
  for (const { file, section } of sections) {
    if (section === null) {
      blocking.push({
        id: "guidance/reuse-marker-missing",
        file,
        message: `expected exactly one ${startMarker} … ${endMarker} pair`,
      });
    }
  }
  if (blocking.length > 0) return { blocking };

  const [reference, ...others] = sections;
  for (const { file, section } of others) {
    if (section !== reference.section) {
      blocking.push({
        id: "guidance/reuse-section-differs",
        file,
        message: `the marked reuse section differs from ${reference.file}; keep both copies identical`,
      });
    }
  }
  return { blocking };
}
