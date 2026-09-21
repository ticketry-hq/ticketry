import { createApolloStore } from "../../../../shared/apollo/localState";

export type BranchInspectorSection = "status" | "pull-request" | "local-merge" | "worktree";

interface BranchInspectorState {
  open: boolean;
  sections: Partial<Record<BranchInspectorSection, boolean>>;
}

const DEFAULT_SECTIONS: Record<BranchInspectorSection, boolean> = {
  status: true,
  "pull-request": true,
  "local-merge": true,
  worktree: false,
};

export const useBranchInspector = createApolloStore<BranchInspectorState>(
  "changes-branch-inspector",
  () => ({ open: false, sections: {} }),
);

export function toggleBranchInspector(open?: boolean): void {
  useBranchInspector.setState((state) => ({ open: open ?? !state.open }));
}

export function setBranchInspectorSection(section: BranchInspectorSection, open: boolean): void {
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
