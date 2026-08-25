import type { ChangedFile, ChangedFileStatus } from "../types";

/**
 * Presentation rules for one changed file.
 *
 * They live apart from the components because the file list, the diff header,
 * and the tab's summary all have to name a change the same way; a status that
 * reads "Modified" in the header and "changed" in the summary is two
 * vocabularies for one fact.
 */

const STATUS_LABELS: Record<ChangedFileStatus, string> = {
  untracked: "New",
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  conflicted: "Conflicted",
};

/**
 * Status reads as colour, not as a word: the file row carries one square
 * swatch in the convention git surfaces share — green for new files, amber
 * for modified, red for deleted and conflicted, idle for renamed and copied.
 * The word itself survives in the accessible name, the hover title, and the
 * diff header, where space is not the constraint.
 */
const STATUS_DOT_TONES: Record<ChangedFileStatus, string> = {
  untracked: "bg-lifecycle-success",
  added: "bg-lifecycle-success",
  modified: "bg-lifecycle-attention",
  deleted: "bg-lifecycle-danger",
  renamed: "bg-lifecycle-idle",
  copied: "bg-lifecycle-idle",
  conflicted: "bg-lifecycle-danger",
};

export function statusLabel(status: ChangedFileStatus): string {
  return STATUS_LABELS[status] ?? "Changed";
}

export function statusDotTone(status: ChangedFileStatus): string {
  return STATUS_DOT_TONES[status] ?? "bg-text-muted";
}

/**
 * What a reviewer reads for a file's size of change.
 *
 * Binary content and content git could not count are distinct from a change
 * of zero lines, so neither borrows "+0 −0".
 */
export function countsLabel(file: ChangedFile): string {
  if (file.binary) return "binary";
  if (file.insertions === null && file.deletions === null) return "size unknown";
  return `+${file.insertions ?? 0} −${file.deletions ?? 0}`;
}

/** The accessible one-line summary of a row: what happened, and how much. */
export function fileAccessibleName(file: ChangedFile): string {
  const origin = file.original_path ? ` from ${file.original_path}` : "";
  return `${file.path}${origin} — ${statusLabel(file.status)}, ${countsLabel(file)}`;
}

/** The header line above the list: how much this worktree changed overall. */
export function summaryLabel(
  fileCount: number,
  insertions: number,
  deletions: number,
): string {
  if (fileCount === 0) return "No changes";
  const files = fileCount === 1 ? "1 file" : `${fileCount} files`;
  return `${files} · +${insertions} −${deletions}`;
}
