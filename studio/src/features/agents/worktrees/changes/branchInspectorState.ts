import { createApolloStore } from "../../../../shared/apollo/localState";

export type BranchInspectorSection =
  | "status"
  | "pull-request"
  | "local-merge"
  | "worktree";

interface BranchInspectorState {
  open: boolean;
  /** Section id to open state. A missing id falls back to the section default. */
  sections: Partial<Record<BranchInspectorSection, boolean>>;
}

const DEFAULT_SECTIONS: Record<BranchInspectorSection, boolean> = {
  status: true,
  "pull-request": true,
  "local-merge": true,
  worktree: false,
};

/**
 * Whether the branch inspector is open, and which of its sections are expanded.
 *
 * The inspector is closed by default so the review surface owns the window on
 * first open; once a reader opens it, it stays open for the session because
 * shipping a branch takes several visits. Apollo's cache stays the one owner of
 * client state, so this rides the same local-state row as every other selector.
 */
export const useBranchInspector = createApolloStore<BranchInspectorState>(
  "changes-branch-inspector",
  () => ({ open: false, sections: {} }),
);

export function toggleBranchInspector(open?: boolean): void {
  useBranchInspector.setState((state) => ({
    open: open ?? !state.open,
  }));
}

export function setBranchInspectorSection(
  section: BranchInspectorSection,
  open: boolean,
): void {
  useBranchInspector.setState((state) => ({
    sections: { ...state.sections, [section]: open },
  }));
}

export function branchInspectorSectionOpen(
  state: BranchInspectorState,
  section: BranchInspectorSection,
): boolean {
  return state.sections[section] ?? DEFAULT_SECTIONS[section];
}
