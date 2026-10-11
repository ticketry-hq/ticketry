import { useEffect, useRef } from "react";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";

/** Full-sidebar return restores the current terminal without a shell RAF. */
export function useWorkspacePresentationReturnFocus({
  enabled, focusAuthorized, activeTab, requestTerminalFocus,
}: {
  enabled: boolean;
  focusAuthorized: boolean;
  activeTab: TaskWorkspaceTabIdentity;
  requestTerminalFocus: (tab: TaskWorkspaceTabIdentity) => void;
}) {
  const wasAuthorizedRef = useRef(focusAuthorized);
  useEffect(() => {
    const returned = focusAuthorized && !wasAuthorizedRef.current;
    wasAuthorizedRef.current = focusAuthorized;
    if (!returned || !enabled || activeTab.kind !== "terminal") return;
    // The request binds this current target to its entry/intent before the
    // terminal adapter waits for reveal or native input ownership.
    requestTerminalFocus(activeTab);
  }, [activeTab.kind, activeTab.kind === "terminal" ? activeTab.id : null,
    enabled, focusAuthorized, requestTerminalFocus]);
}
