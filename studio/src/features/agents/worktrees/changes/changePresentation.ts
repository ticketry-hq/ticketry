export type WorktreeFileStatus =
  | "added"
  | "untracked"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "conflicted";

interface ChangePresentation {
  label: string;
  explanation: string;
  toneClass: string;
}

const PRESENTATION: Record<WorktreeFileStatus, ChangePresentation> = {
  added: {
    label: "Added",
    explanation: "New tracked file.",
    toneClass: "text-lifecycle-success",
  },
  untracked: {
    label: "Untracked",
    explanation: "New file not yet tracked by Git.",
    toneClass: "text-lifecycle-success",
  },
  modified: {
    label: "Modified",
    explanation: "Existing file changed.",
    toneClass: "text-lifecycle-attention",
  },
  deleted: {
    label: "Deleted",
    explanation: "File removed.",
    toneClass: "text-lifecycle-danger",
  },
  renamed: {
    label: "Renamed",
    explanation: "File moved to a new path.",
    toneClass: "text-text-muted",
  },
  copied: {
    label: "Copied",
    explanation: "File copied from another path.",
    toneClass: "text-text-muted",
  },
  conflicted: {
    label: "Conflicted",
    explanation: "File has unresolved merge conflicts.",
    toneClass: "text-lifecycle-danger",
  },
};

export function changePresentation(status: string): ChangePresentation {
  return PRESENTATION[status as WorktreeFileStatus] ?? {
    label: status,
    explanation: "Git reported this file status.",
    toneClass: "text-text-muted",
  };
}
