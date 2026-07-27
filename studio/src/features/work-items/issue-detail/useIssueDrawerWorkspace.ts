import { useEffect } from "react";
import { useIssueDrawerWorkspaceStore } from "./internal/drawerWorkspaceStore";

export function useIssueDrawerWorkspace(issueKey: string | null) {
  const workspace = useIssueDrawerWorkspaceStore((state) =>
    issueKey ? state.byIssueKey[issueKey] ?? null : null,
  );
  const hydrate = useIssueDrawerWorkspaceStore((state) => state.hydrate);

  useEffect(() => {
    if (issueKey) void hydrate(issueKey);
  }, [hydrate, issueKey]);

  return { workspace };
}
