import { changePresentation } from "./changePresentation";

const LETTERS: Record<string, string> = {
  added: "A",
  untracked: "U",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  conflicted: "!",
};

export interface ChangedFileBadge {
  letter: string;
  label: string;
  explanation: string;
  toneClass: string;
}

/**
 * A changed file's status as one letter in its lifecycle colour.
 *
 * Full words in the same weight as the counts made every row read alike. A
 * single letter in a fixed column lets the eye scan status down the list, and
 * the word stays in the accessible name for anyone not reading colour.
 */
export function changedFileBadge(status: string): ChangedFileBadge {
  const presentation = changePresentation(status);
  return {
    letter: LETTERS[status] ?? status.slice(0, 1).toUpperCase(),
    label: presentation.label,
    explanation: presentation.explanation,
    toneClass: presentation.toneClass,
  };
}
