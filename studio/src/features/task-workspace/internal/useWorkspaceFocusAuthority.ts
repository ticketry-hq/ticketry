import { useCallback, useRef, type RefObject } from "react";
import { modalOcclusionActive, useModalOcclusionActive, type ForegroundOwner } from "../../agents/terminal";
import { useClientStore } from "../../../state/clientStore";
import { isDialogFocusTarget, isTypingTarget } from "../../../shared/utilities/keyboard";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";

/** Focus requests carry the same entry/intent authority as async selection. */
export function useWorkspaceFocusAuthority({ bucket, owner, workspaceActive, paneRef, captureIntent }: {
  bucket: string | null;
  owner: ForegroundOwner;
  workspaceActive: boolean;
  paneRef: RefObject<HTMLDivElement>;
  captureIntent: () => (() => boolean);
}) {
  const occluded = useModalOcclusionActive();
  const presentationRef = useRef(workspaceActive);
  presentationRef.current = workspaceActive;
  const captureFocusIntent = useCallback((tab: TaskWorkspaceTabIdentity) => {
    const isCurrent = captureIntent();
    return (target?: HTMLElement | null): boolean => {
      if (!isCurrent() || !presentationRef.current || modalOcclusionActive()) return false;
      const state = useClientStore.getState();
      const workspace = bucket ? state.workspaces[bucket] : null;
      if (workspace?.active !== tab.kind ||
        (tab.kind === "doc" && workspace.activeDocId !== tab.id) ||
        (tab.kind === "terminal" && state.activeByTask[bucket!] !== tab.id)) return false;
      if (owner === "studio" && !state.sidebarVisible &&
        (!state.editViewBodyEngaged || state.editViewZone !== "active-tab-body")) return false;
      const focused = document.activeElement;
      if (isDialogFocusTarget(focused) && !paneRef.current?.contains(focused)) return false;
      if (isTypingTarget(focused) && !target?.contains(focused)) return false;
      return true;
    };
  }, [bucket, captureIntent, owner, paneRef]);
  return { focusAuthorized: workspaceActive && !occluded, captureFocusIntent };
}
