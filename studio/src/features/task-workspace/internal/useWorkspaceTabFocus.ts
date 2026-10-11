import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { SessionMeta } from "../../agents/terminal";
import type { EditViewZone } from "../../../state/clientStore";
import type { TabKind } from "../../agents/types";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import { resolveOriginatingSession } from "./useRememberPendingTerminalTarget";
import { isDialogFocusTarget, isTypingTarget } from "../../../shared/utilities/keyboard";

export function useRekeyedTerminalFocus({
  activeTerminalId,
  sessions,
  requestedTerminalRef,
  requestedTerminalIntentRef,
  requestTerminalFocus,
  focusAuthorized,
}: {
  activeTerminalId: string | null;
  sessions: Readonly<Record<string, SessionMeta>>;
  requestedTerminalIntentRef: MutableRefObject<(() => boolean) | null>;
  requestTerminalFocus: (tab: TaskWorkspaceTabIdentity) => void;
  focusAuthorized: boolean;
  requestedTerminalRef: MutableRefObject<string | null>;
}): void {
  useEffect(() => {
    const requestedId = requestedTerminalRef.current;
    if (
      !focusAuthorized || !requestedTerminalIntentRef.current?.() ||
      !activeTerminalId ||
      !requestedId?.startsWith("tmp_") ||
      sessions[requestedId]
    ) {
      return;
    }
    const successor = resolveOriginatingSession(sessions, requestedId);
    if (successor?.sessionId !== activeTerminalId) {
      requestedTerminalRef.current = null;
      return;
    }
    // Ready rekeys tmp → server id; keep the pending terminal-focus request on
    // the same active tab so that identity change cannot consume its signal.
    requestTerminalFocus({ kind: "terminal", id: activeTerminalId });
  }, [
    activeTerminalId,
    requestedTerminalIntentRef,
    requestTerminalFocus,
    focusAuthorized,
    requestedTerminalRef,
    sessions,
    ]);
}

export function useEditViewWorkspaceFocus({
  activeTab,
  activeDocumentId,
  activeTerminalId,
  activeKind,
  bucket,
  isEditView,
  editViewBodyEngaged,
  editViewZone,
  tabStripRef,
  bodyRef,
  setHighlightedTab,
  requestSurfaceFocus,
  requestTerminalFocus,
  focusAuthorized,
}: {
  activeTab: TaskWorkspaceTabIdentity;
  activeDocumentId: string | null;
  activeTerminalId: string | null;
  activeKind: TabKind;
  bucket: string | null;
  isEditView: boolean;
  editViewBodyEngaged: boolean;
  editViewZone: EditViewZone;
  tabStripRef: RefObject<HTMLDivElement>;
  bodyRef: RefObject<HTMLDivElement>;
  setHighlightedTab: Dispatch<SetStateAction<TaskWorkspaceTabIdentity>>;
  requestSurfaceFocus: (tab: TaskWorkspaceTabIdentity) => void;
  requestTerminalFocus: (tab: TaskWorkspaceTabIdentity) => void;
  focusAuthorized: boolean;
}): void {
  useEffect(() => {
    if (!focusAuthorized || !isEditView || !editViewBodyEngaged || activeTab.kind === "terminal") return;
    requestSurfaceFocus(activeTab);
  }, [activeTab.kind, activeTab.kind === "doc" ? activeTab.id : null,
    bucket, editViewBodyEngaged, isEditView, requestSurfaceFocus, focusAuthorized]);

  useEffect(() => {
    if (
      !focusAuthorized || !isEditView ||
      !editViewBodyEngaged ||
      activeTab.kind !== "terminal"
    ) {
      return;
    }
    // Engagement is global Studio navigation state and intentionally survives
    // a selected-ticket change. Re-issue focus for the terminal that is now
    // presented, including after restore/reattach changes its session id.
    requestTerminalFocus(activeTab);
  }, [
    activeTab.kind,
    activeTab.kind === "terminal" ? activeTab.id : null,
    bucket,
    editViewBodyEngaged,
    isEditView,
    focusAuthorized,
    requestTerminalFocus,
  ]);

  useEffect(() => {
    if (!focusAuthorized || !isEditView) return;
    if (isDialogFocusTarget(document.activeElement)) return;
    if (isTypingTarget(document.activeElement) && !bodyRef.current?.contains(document.activeElement)) return;
    if (editViewZone === "tab-strip") {
      if (!tabStripRef.current?.contains(document.activeElement)) {
        tabStripRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (editViewZone !== "active-tab-body") return;
    if (document.activeElement === bodyRef.current) return;
    // Editors and terminal inputs already own focus inside this zone.
    // Claiming the body must not pull focus away from the selected control.
    if (bodyRef.current?.contains(document.activeElement)) return;
    bodyRef.current?.focus({ preventScroll: true });
  }, [bodyRef, editViewZone, isEditView, tabStripRef, focusAuthorized]);

  useEffect(() => {
    if (!isEditView || editViewZone !== "tab-strip") return;
    setHighlightedTab(activeTab);
  }, [
    activeDocumentId,
    activeTerminalId,
    activeKind,
    bucket,
    editViewZone,
    isEditView,
    setHighlightedTab,
  ]);
}
