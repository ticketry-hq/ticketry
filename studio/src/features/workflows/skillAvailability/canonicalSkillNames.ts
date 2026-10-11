import type { SkillAvailabilityResult } from "./types";

/**
 * The list a stage-skill save writes: each case-only match takes the
 * installed directory's spelling, and names that differ only in case collapse
 * to the first. Names the result does not describe keep their spelling.
 */
export function canonicalSkillNames(
  names: string[],
  result: SkillAvailabilityResult | null,
): string[] {
  const installed = new Map<string, string>();
  for (const skill of result?.skills ?? []) {
    if (skill.status === "available" && skill.installed_name) {
      installed.set(skill.requested, skill.installed_name);
    }
  }
  const seen = new Set<string>();
  const canonical: string[] = [];
  for (const name of names) {
    const spelling = installed.get(name) ?? name;
    const folded = spelling.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    canonical.push(spelling);
  }
  return canonical;
}

/** Whether `name` is already in `names` ignoring case. */
export function hasSkillName(names: string[], name: string): boolean {
  const folded = name.toLowerCase();
  return names.some((candidate) => candidate.toLowerCase() === folded);
}
