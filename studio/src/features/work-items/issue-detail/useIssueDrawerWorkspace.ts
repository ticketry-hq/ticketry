import { useEffect } from "react";
import { useIssueDrawerWorkspaceStore } from "./internal/drawerWorkspaceStore";
import { useIssueStore } from "./internal/issueStore";

export function useIssueDrawerWorkspace(issueKey: string | null) {
  const workspace = useIssueDrawerWorkspaceStore((state) =>
    issueKey ? state.byIssueKey[issueKey] ?? null : null,
  );
  const hydrate = useIssueDrawerWorkspaceStore((state) => state.hydrate);
  const task = useIssueStore((state) =>
    workspace?.taskId ? state.workItemsById[workspace.taskId] ?? null : null,
  );

  useEffect(() => {
    if (issueKey) void hydrate(issueKey);
  }, [hydrate, issueKey]);

  // The drawer keeps workspace metadata and an id. Reading the record here
  // means status frames and mutations become visible without a drawer mirror.
  return { workspace: workspace ? { ...workspace, task } : null };
}
