import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  hasFocusedTerminalInput,
  type SessionMeta,
} from "../../../../../features/agents/terminal";
import type { EditViewZone } from "../../../../../state/clientStore";
import type { TabKind } from "../../../../../features/agents/types";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import { isDialogFocusTarget } from "../../../../../shared/utilities/keyboard";

export function useRekeyedTerminalFocus({
  activeTerminalId,
  sessions,
  requestedTerminalRef,
  setTerminalFocusSignal,
}: {
  activeTerminalId: string | null;
  sessions: Readonly<Record<string, SessionMeta>>;
  requestedTerminalRef: MutableRefObject<string | null>;
  setTerminalFocusSignal: Dispatch<SetStateAction<number>>;
}): void {
  useEffect(() => {
    const requestedId = requestedTerminalRef.current;
    if (
      !activeTerminalId ||
      !requestedId?.startsWith("tmp_") ||
      sessions[requestedId]
    ) {
      return;
    }
    // Ready rekeys tmp → server id; keep the pending terminal-focus request on
    // the same active tab so that identity change cannot consume its signal.
    requestedTerminalRef.current = activeTerminalId;
    setTerminalFocusSignal((signal) => signal + 1);
  }, [
    activeTerminalId,
    requestedTerminalRef,
    sessions,
    setTerminalFocusSignal,
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
  requestedTerminalRef,
  setTerminalFocusSignal,
  setHighlightedTab,
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
  requestedTerminalRef: MutableRefObject<string | null>;
  setTerminalFocusSignal: Dispatch<SetStateAction<number>>;
  setHighlightedTab: Dispatch<SetStateAction<TaskWorkspaceTabIdentity>>;
}): void {
  useEffect(() => {
    if (
      !isEditView ||
      !editViewBodyEngaged ||
      activeTab.kind !== "terminal"
    ) {
      return;
    }
    // Engagement is global Studio navigation state and intentionally survives
    // a selected-ticket change. Re-issue focus for the terminal that is now
    // presented, including after restore/reattach changes its session id.
    requestedTerminalRef.current = activeTab.id;
    setTerminalFocusSignal((signal) => signal + 1);
  }, [
    activeTab.kind,
    activeTab.kind === "terminal" ? activeTab.id : null,
    bucket,
    editViewBodyEngaged,
    isEditView,
    requestedTerminalRef,
    setTerminalFocusSignal,
  ]);

  useEffect(() => {
    if (!isEditView) return;
    if (isDialogFocusTarget(document.activeElement)) return;
    if (editViewZone === "tab-strip") {
      if (document.activeElement !== tabStripRef.current) {
        tabStripRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (editViewZone !== "active-tab-body") return;
    if (document.activeElement === bodyRef.current) return;
    // A terminal parks focus on a hidden input inside the body. That already
    // counts as focused-in-zone; pulling focus back to the body would blur the
    // terminal the user just clicked into.
    if (hasFocusedTerminalInput(bodyRef.current)) return;
    bodyRef.current?.focus({ preventScroll: true });
  }, [bodyRef, editViewZone, isEditView, tabStripRef]);

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
