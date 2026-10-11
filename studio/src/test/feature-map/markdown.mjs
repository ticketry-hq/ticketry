export const sections = ["Sub-features", "How to get to it", "Prerequisites", "Expected behavior", "Verifying it", "Relevant code", "Gotchas"];

export function linkPath(link) {
  try { return decodeURIComponent(link.split("#")[0]); } catch { return null; }
}

export function markdownLinks(source, referenceSource = source) {
  const stripExamples = (text) => text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[^]*?^\s*\1\s*$/gm, "");
  const normalize = (label) => label.trim().toLowerCase().replace(/\s+/g, " ");
  const definitions = new Map([...stripExamples(referenceSource).matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)]
    .map((match) => [normalize(match[1]), match[2] ?? match[3]]));
  let prose = stripExamples(source).replace(/^ {0,3}\[[^\]]+\]:[^\n]*$/gm, "");
  const links = [];
  prose = prose.replace(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^]*?["'])?\)/g, (_match, angle, plain) => {
    links.push(angle ?? plain); return "";
  });
  prose = prose.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (_match, label, reference) => {
    const target = definitions.get(normalize(reference || label));
    if (target) links.push(target);
    return "";
  });
  for (const match of prose.matchAll(/\[([^\]]+)\]/g)) {
    const target = definitions.get(normalize(match[1]));
    if (target) links.push(target);
  }
  return links.filter((link) => !/^[a-z][a-z\d+.-]*:|^\/\//i.test(link));
}

export function sectionBodies(source) {
  const headings = [...source.matchAll(/^## ([^\n]+)\r?$/gm)];
  return new Map(headings.map((match, index) => [
    match[1].trim(), source.slice(match.index + match[0].length, headings[index + 1]?.index).trim(),
  ]));
}

export function validStructure(source) {
  const headings = [...source.matchAll(/^## ([^\n]+)\r?$/gm)].map((match) => match[1].trim());
  const surfaces = [...source.matchAll(/^Surfaces:\s*([^\n]+)$/gm)];
  const values = surfaces[0]?.[1].trim().split(/\s*,\s*/) ?? [];
  return [...source.matchAll(/^# \S.*$/gm)].length === 1
    && surfaces.length === 1 && values.length > 0
    && new Set(values).size === values.length
    && values.every((value) => ["browser", "desktop", "manual"].includes(value))
    && (JSON.stringify(headings) === JSON.stringify(sections) || JSON.stringify(headings) === JSON.stringify([...sections.slice(0, 5), "End-to-end suite", ...sections.slice(5)]))
    && [...sectionBodies(source).values()].every((body) => body.replace(/<!--[^]*?-->/g, "").trim().length > 0);
}
