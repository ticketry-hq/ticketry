import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useWorkspaceDocuments } from "../../documents";
import {
  isScratchBucket,
  useTerminalStore,
} from "../../agents/terminal";
import {
  useClientStore as useTicketWorkspaceStore,
} from "../../../state/clientStore";
import {
  useTaskWorkspaceTabNavigation,
  type TaskWorkspaceTabIdentity,
} from "./useTaskWorkspaceTabNavigation";
import { useClientStore } from "../../../state/clientStore";
import { useWorkspaceTerminalSessions } from "../terminals/useWorkspaceTerminalSessions";
import { useWorkspaceTabActions } from "./useWorkspaceTabActions";
import {
  useStudioDocumentRestoration,
  useStudioWorkspaceRestoration,
} from "./useStudioWorkspaceRestoration";
import { useRememberPendingTerminalTarget, type PendingTerminalTarget } from "./useRememberPendingTerminalTarget";
import {
  useEditViewWorkspaceFocus,
  useRekeyedTerminalFocus,
} from "./useWorkspaceTabFocus";
import { useWorkspaceFocusAuthority } from "./useWorkspaceFocusAuthority";
import { useWorkspacePresentationReturnFocus } from "./useWorkspacePresentationReturnFocus";
import { useWorkspaceTabPresentation } from "./useWorkspaceTabPresentation";
import { useWorkspaceTabOrdering } from "../../workspace-tabs/useWorkspaceTabOrdering";
import { useWorkspaceTabOrder } from "../../workspace-tabs/queries";
import { useTaskWorktreeChangesTabLifecycle } from "./useTaskWorktreeChangesTabLifecycle";

import type { TaskWorkspaceProps } from "../types";
import { rememberStudioWorkspaceTarget } from "../../workspace-state/studioWorkspaceTarget";

/** Coordinates restoration and activation privately for the rendered workspace. */
export function useTaskWorkspace({
  bucket,
  projectId,
  moduleId,
  owner,
  workspaceActive = true,
  launchContext = null,
  entrySignal = 0,
  onBeforeFirstTab,
  modal = false,
  conversationRunId = null,
}: TaskWorkspaceProps) {
  const {
    sessions,
    tabs,
    activeTerminalId: activeTermIdOrNull,
    scratch,
    workspaceRuns,
    endedRuns,
    resumableSessions,
    restorationExcludedRunIds,
    runsResolved,
  } = useWorkspaceTerminalSessions(
    bucket,
    projectId,
    moduleId,
    conversationRunId,
  );
  const ensureWorkspace = useTicketWorkspaceStore((s) => s.ensureWorkspace);
  const setActive = useTicketWorkspaceStore((s) => s.setActive);
  const setActiveDoc = useTicketWorkspaceStore((s) => s.setActiveDoc);
  const paneRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const launcherTriggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const detailsSurfaceRef = useRef<HTMLDivElement>(null);
  const requestedSurfaceRef = useRef<TaskWorkspaceTabIdentity | null>(null);
  const requestedTerminalRef = useRef<string | null>(null);
  const requestedTerminalIntentRef = useRef<(() => boolean) | null>(null);
  const terminalFocusAuthorityRef = useRef<((target?: HTMLElement | null) => boolean) | null>(null);
  const rememberPendingTerminalRef = useRef<PendingTerminalTarget | null>(null);
  const [surfaceFocusSignal, setSurfaceFocusSignal] = useState(0);
  const [terminalFocusSignal, setTerminalFocusSignal] = useState(0);
  const [highlightedTab, setHighlightedTab] =
    useState<TaskWorkspaceTabIdentity>({ kind: "details" });
  const editViewZone = useClientStore((state) => state.editViewZone);
  const editViewBodyEngaged = useClientStore(
    (state) => state.editViewBodyEngaged,
  );
  const navigationModality = useClientStore((state) => state.navigationModality);
  const setEditViewZone = useClientStore((state) => state.setEditViewZone);
  const setEditViewBodyEngaged = useClientStore(
    (state) => state.setEditViewBodyEngaged,
  );
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const isEditView = owner === "studio" && !sidebarVisible && workspaceActive;
  const surfaceFocusAuthorityRef = useRef<((target?: HTMLElement | null) => boolean) | null>(null);

  // Seed defaults when a ticket is first selected.
  useEffect(() => {
    if (bucket) ensureWorkspace(bucket);
  }, [bucket, ensureWorkspace]);

  const {
    restorationEntry,
    restoreRequestRef,
    restoreGenerationRef,
    restoreTerminalTarget,
    cancelRestoration,
    isCurrentRestoration,
    captureIntent,
  } = useStudioWorkspaceRestoration({
    bucket,
    projectId,
    moduleId,
    owner,
    setActive,
    requestedSurfaceRef,
    requestedTerminalRef,
    rememberPendingTerminalRef,
    excludedRunIds: restorationExcludedRunIds,
    explicitTerminalRunId: conversationRunId,
    workspaceActive,
  });

  const { focusAuthorized, captureFocusIntent } = useWorkspaceFocusAuthority({
    bucket, owner, workspaceActive, paneRef, captureIntent,
  });
  const requestSurfaceFocus = useCallback((tab: TaskWorkspaceTabIdentity): void => {
    surfaceFocusAuthorityRef.current = captureFocusIntent(tab);
    requestedSurfaceRef.current = tab;
    setSurfaceFocusSignal((signal) => signal + 1);
  }, [captureFocusIntent]);
  const requestTerminalFocus = useCallback((tab: TaskWorkspaceTabIdentity): void => {
    if (tab.kind !== "terminal" || !captureFocusIntent(tab)(paneRef.current)) return;
    terminalFocusAuthorityRef.current = captureFocusIntent(tab);
    requestedTerminalIntentRef.current = captureIntent();
    requestedTerminalRef.current = tab.id;
    setTerminalFocusSignal((signal) => signal + 1);
  }, [captureFocusIntent, captureIntent]);
  const engageWorkspaceTab = useCallback((tab: TaskWorkspaceTabIdentity): void => {
    setEditViewBodyEngaged(true);
    if (tab.kind === "terminal") {
      requestedTerminalRef.current = tab.id;
      // Edit-view terminal focus is synchronized from the committed engaged
      // state below. Other workspace owners do not have that state, so their
      // explicit engagement remains an immediate focus request.
      if (!isEditView) {
        requestTerminalFocus(tab);
      }
      return;
    }
    requestSurfaceFocus(tab);
  }, [isEditView, requestSurfaceFocus, requestTerminalFocus, setEditViewBodyEngaged]);

  useLayoutEffect(() => {
    if (!bucket || entrySignal === 0) return;
    cancelRestoration();
    setActive(bucket, "details");
    if (owner === "studio") {
      rememberStudioWorkspaceTarget(bucket, { kind: "details" });
    }
    engageWorkspaceTab({ kind: "details" });
  }, [bucket, cancelRestoration, entrySignal, owner, setActive]);

  useEffect(() => {
    if (surfaceFocusSignal === 0) return;
    if (requestedSurfaceRef.current?.kind === "details") {
      const target = detailsSurfaceRef.current;
      // A control inside Details already satisfies engagement: an editor the
      // same gesture opened, or an invoking control a closed modal returned
      // focus to. Engaging the surface must not blur either.
      const focused = document.activeElement;
      if (focused !== target && target?.contains(focused)) return;
      if (surfaceFocusAuthorityRef.current?.(target)) target?.focus();
    }
  }, [surfaceFocusSignal]);

  const documentQuery = useWorkspaceDocuments(
    bucket,
    projectId,
    moduleId,
    isScratchBucket(bucket),
  );
  const workspaceDocuments = conversationRunId ? [] : documentQuery.documents;

  useStudioDocumentRestoration({
    bucket,
    owner,
    documents: workspaceDocuments,
    documentsFetched: documentQuery.isFetched,
    restorationEntry,
    restoreRequestRef,
    restoreGenerationRef,
    isCurrentRestoration,
    setActive,
    setActiveDoc,
  });

  // ProjectRunStatus already knows which live runs belong to this workspace.
  // Materialize their connecting tabs before paint so reopening a task never
  // shows its lifecycle badge without the matching terminal tab. Attaching the
  // viewer remains asynchronous and may keep the tab in "connecting".
  useLayoutEffect(() => {
    if (!bucket) return;
    useTerminalStore.getState().reconcileRunTabs(
      bucket,
      workspaceRuns,
      restorationExcludedRunIds,
    );
    restoreTerminalTarget(bucket, restoreGenerationRef.current, runsResolved);
  }, [
    bucket,
    restorationExcludedRunIds,
    restoreTerminalTarget,
    workspaceRuns,
    runsResolved,
  ]);

  const sessionByRun = useTerminalStore((s) => s.sessionByRun);
  const workspaceTabWorkItemId = bucket && !isScratchBucket(bucket) ? bucket : null;
  const hasTaskChangesTab = useTaskWorktreeChangesTabLifecycle({
    taskId: workspaceTabWorkItemId,
    owner,
  });
  const hasChangesTab = (scratch && moduleId !== null) || hasTaskChangesTab;
  const savedTabOrder = useWorkspaceTabOrder(workspaceTabWorkItemId);

  useEffect(() => {
    const request = restoreRequestRef.current;
    if (
      owner !== "studio" ||
      !bucket ||
      request?.bucket !== bucket ||
      request.generation !== restoreGenerationRef.current ||
      request.target.kind !== "terminal"
    ) {
      return;
    }
    // Resolve terminals only after live-session reattachment.

    restoreTerminalTarget(bucket, request.generation, false);
  }, [bucket, owner, sessionByRun, restoreTerminalTarget]);

  const activeTermId = activeTermIdOrNull;
  useRekeyedTerminalFocus({
    activeTerminalId: activeTermId,
    sessions,
    requestedTerminalRef,
    requestedTerminalIntentRef,
    requestTerminalFocus,
    focusAuthorized,
  });
  const {
    terminalIds: termIds,
    openDocuments: openDocs,
    closedDocuments: closedDocs,
    resumable,
    dormantChips,
    activeDocument: activeDoc,
    activeKind: effActive,
    navigableTabs,
    activeTab,
  } = useWorkspaceTabPresentation({
    bucket,
    projectId,
    moduleId,
    documents: workspaceDocuments,
    terminalTabs: tabs,
    activeTerminalId: activeTermId,
    resumableSessions,
    endedRuns,
    savedTabOrder: savedTabOrder.order,
    hasChangesTab,
    terminalOnly: Boolean(conversationRunId),
  });
  const workspaceTabReorder = useWorkspaceTabOrdering({
    workItemId: workspaceTabWorkItemId,
    savedOrder: savedTabOrder,
    documents: workspaceDocuments,
    openDocuments: openDocs,
    terminalTabs: tabs,
    resumableSessions,
    visibleOrder: navigableTabs,
    hasChangesTab,
  });

  useEditViewWorkspaceFocus({
    activeTab,
    activeDocumentId: activeDoc?.id ?? null,
    activeTerminalId: activeTermId,
    activeKind: effActive,
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
  });

  useWorkspacePresentationReturnFocus({
    enabled: owner === "studio" && sidebarVisible,
    focusAuthorized,
    activeTab,
    requestTerminalFocus,
  });

  useRememberPendingTerminalTarget({
    bucket,
    owner,
    sessions,
    rememberPendingTerminalRef,
  });

  const {
    selectWorkspaceTab,
    activateWorkspaceTerminal,
    diveWorkspaceTab,
    claimPointerZone,
    closeWorkspaceDocument,
    reopenWorkspaceDocument,
    closeWorkspaceTerminal,
    resumeWorkspaceTerminal,
    rememberLaunchedTaskAgent,
    beginTaskAgentLaunch,
    resumingRunIds,
  } = useWorkspaceTabActions({
    bucket,
    projectId,
    moduleId,
    owner,
    scratch,
    activeKind: effActive,
    activeDocument: activeDoc,
    activeTerminalId: activeTermId,
    terminalIds: termIds,
    documents: workspaceDocuments,
    sessions,
    isEditView,
    launchContext,
    engageTab: engageWorkspaceTab,
    cancelRestoration,
    captureIntent,
    rememberPendingTerminalRef,
  });

  // Body engagement is also explicit destination intent, including engaging
  // the Details placeholder while a remembered target is still hydrating.
  function activateWorkspaceTab(tab: TaskWorkspaceTabIdentity): void {
    selectWorkspaceTab(tab);
    if (isEditView) engageWorkspaceTab(tab);
  }

  // Command-arrow is tab navigation, not an editing chord. A document editor
  // keeps Command-Left/Right for line movement, so an engaged arrival on a
  // document lands in navigation mode on the tab body; Enter engages it.
  function navigateWorkspaceTab(tab: TaskWorkspaceTabIdentity): void {
    selectWorkspaceTab(tab);
    if (tab.kind !== "doc" || !isEditView || !editViewBodyEngaged) return;
    setEditViewBodyEngaged(false);
    bodyRef.current?.focus({ preventScroll: true });
  }

  useTaskWorkspaceTabNavigation({
    tabs: bucket && focusAuthorized ? navigableTabs : [],
    activeTab,
    highlightedTab,
    highlightTab: setHighlightedTab,
    selectTab: navigateWorkspaceTab,
    diveTab: diveWorkspaceTab,
    engageTab: activateWorkspaceTab,
    launcherTriggerRef,
    onBeforeFirst: onBeforeFirstTab,
    modal,
  });

  return {
    paneRef, tabStripRef, launcherTriggerRef, bodyRef, detailsSurfaceRef,
    isEditView, editViewZone, editViewBodyEngaged, navigationModality, setEditViewZone,
    highlightedTab, effActive, activeDoc, activeTermId, openDocs, closedDocs, tabs,
    navigableTabs, activeTab, workspaceTabReorder, claimPointerZone, selectWorkspaceTab,
    activateWorkspaceTerminal, closeWorkspaceDocument, closeWorkspaceTerminal,
    rememberLaunchedTaskAgent, beginTaskAgentLaunch, resumable, dormantChips, resumingRunIds,
    reopenWorkspaceDocument, resumeWorkspaceTerminal, termIds,
    requestedSurfaceRef, surfaceFocusSignal, requestedTerminalRef, terminalFocusSignal,
    canFocusSurface: surfaceFocusAuthorityRef.current,
    canFocusTerminal: terminalFocusAuthorityRef.current,
    engageWorkspaceTab: activateWorkspaceTab,
  };
}
