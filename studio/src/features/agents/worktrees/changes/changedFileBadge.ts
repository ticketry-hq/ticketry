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

export function changedFileBadge(status: string) {
  const presentation = changePresentation(status);
  return {
    letter: LETTERS[status] ?? status.slice(0, 1).toUpperCase(),
    label: presentation.label,
    explanation: presentation.explanation,
    toneClass: presentation.toneClass,
  };
}
