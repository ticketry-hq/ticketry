import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkspaceDocuments } from "./documents/queries";
import {
  isScratchBucket,
  useTerminalStore,
  type ForegroundOwner,
} from "../../../../features/agents/terminal";
import {
  useClientStore as useTicketWorkspaceStore,
} from "../../../../state/clientStore";
import {
  useTaskWorkspaceTabNavigation,
  type TaskWorkspaceTabIdentity,
} from "./internal/useTaskWorkspaceTabNavigation";
import { useClientStore } from "../../../../state/clientStore";
import { WorkspaceTabStrip } from "./internal/WorkspaceTabStrip";
import { DormantWorkspaceTabs } from "./internal/DormantWorkspaceTabs";
import { WorkspaceTabBody } from "./internal/WorkspaceTabBody";
import type { WorkspaceLauncherContext } from "./internal/WorkspaceLauncher";
import { useWorkspaceTerminalSessions } from "./terminals/useWorkspaceTerminalSessions";
import { useWorkspaceTabActions } from "./internal/useWorkspaceTabActions";
import {
  useRememberPendingTerminalTarget,
  useStudioDocumentRestoration,
  useStudioWorkspaceRestoration,
} from "./internal/useStudioWorkspaceRestoration";
import {
  useEditViewWorkspaceFocus,
  useRekeyedTerminalFocus,
} from "./internal/useWorkspaceTabFocus";
import { useWorkspaceTabPresentation } from "./internal/useWorkspaceTabPresentation";
import { useWorkspaceTabOrdering } from "../../../../features/workspace-tabs/useWorkspaceTabOrdering";
import { useWorkspaceTabOrder } from "../../../../features/workspace-tabs/queries";
import { useTaskWorktreeChangesTabLifecycle } from "./internal/useTaskWorktreeChangesTabLifecycle";

export type {
  ScratchLaunchMode,
  TicketLaunchContext,
  WorkspaceLauncherContext,
} from "./internal/WorkspaceLauncher";

/**
 * The per-ticket right pane: a tab strip (pinned Details, closable Doc, N
 * closable terminal tabs) plus a chip row (reopen-doc chip when the doc is
 * closed, inert history chips for terminated runs) over a content region.
 * TerminalHost and DocTab are rendered unconditionally so xterm instances and
 * the doc iframe persist across ticket switches; only visibility is toggled.
 */
export function SelectedTicketContent({
  bucket,
  projectId,
  moduleId,
  owner,
  details,
  launchContext = null,
  entrySignal = 0,
  onBeforeFirstTab,
  modal = false,
  conversationRunId = null,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  owner: ForegroundOwner;
  details: ReactNode;
  launchContext?: WorkspaceLauncherContext | null;
  entrySignal?: number;
  onBeforeFirstTab?: () => void;
  /** True only when this workspace is hosted by the issue-drawer overlay. */
  modal?: boolean;
  /** Restrict a Conversations row to the one terminal run that row owns. */
  conversationRunId?: string | null;
}) {
  const {
    sessions,
    tabs,
    activeTerminalId: activeTermIdOrNull,
    scratch,
    workspaceRuns,
    resumableSessions,
    restorationExcludedRunIds,
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
  const rememberPendingTerminalRef = useRef(false);
  const [surfaceFocusSignal, setSurfaceFocusSignal] = useState(0);
  const [terminalFocusSignal, setTerminalFocusSignal] = useState(0);
  const [highlightedTab, setHighlightedTab] =
    useState<TaskWorkspaceTabIdentity>({ kind: "details" });
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const editViewZone = useClientStore((state) => state.editViewZone);
  const editViewBodyEngaged = useClientStore(
    (state) => state.editViewBodyEngaged,
  );
  const navigationModality = useClientStore((state) => state.navigationModality);
  const setEditViewZone = useClientStore((state) => state.setEditViewZone);
  const setEditViewBodyEngaged = useClientStore(
    (state) => state.setEditViewBodyEngaged,
  );
  const isEditView =
    owner === "studio" && !sidebarVisible;
  const engageWorkspaceTab = useCallback((tab: TaskWorkspaceTabIdentity): void => {
    setEditViewBodyEngaged(true);
    if (tab.kind === "terminal") {
      requestedTerminalRef.current = tab.id;
      // Edit-view terminal focus is synchronized from the committed engaged
      // state below. Other workspace owners do not have that state, so their
      // explicit engagement remains an immediate focus request.
      if (!isEditView) {
        setTerminalFocusSignal((signal) => signal + 1);
      }
      return;
    }
    requestedSurfaceRef.current = tab;
    setSurfaceFocusSignal((signal) => signal + 1);
  }, [isEditView, setEditViewBodyEngaged]);

  // Seed defaults when a ticket is first selected.
  useEffect(() => {
    if (bucket) ensureWorkspace(bucket);
  }, [bucket, ensureWorkspace]);

  const {
    restoreRequestRef,
    restoreGenerationRef,
    restoreTerminalTarget,
  } = useStudioWorkspaceRestoration({
    bucket,
    owner,
    setActive,
    requestedSurfaceRef,
    requestedTerminalRef,
    rememberPendingTerminalRef,
    explicitTerminalRunId: conversationRunId,
  });

  useEffect(() => {
    if (!bucket || entrySignal === 0) return;
    setActive(bucket, "details");
    engageWorkspaceTab({ kind: "details" });
  }, [bucket, engageWorkspaceTab, entrySignal, setActive]);

  useEffect(() => {
    if (surfaceFocusSignal === 0) return;
    if (requestedSurfaceRef.current?.kind === "details") {
      detailsSurfaceRef.current?.focus();
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
    restoreRequestRef,
    restoreGenerationRef,
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
    restoreTerminalTarget(bucket, restoreGenerationRef.current, true);
  }, [
    bucket,
    restorationExcludedRunIds,
    restoreTerminalTarget,
    workspaceRuns,
  ]);

  const sessionByRun = useTerminalStore((s) => s.sessionByRun);
  const workspaceTabWorkItemId = bucket && !isScratchBucket(bucket) ? bucket : null;
  const hasTaskChangesTab = useTaskWorktreeChangesTabLifecycle({ taskId: workspaceTabWorkItemId, owner });
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
    setTerminalFocusSignal,
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
    requestedTerminalRef,
    setTerminalFocusSignal,
    setHighlightedTab,
  });

  useRememberPendingTerminalTarget({
    bucket,
    owner,
    activeTerminalId: activeTermId,
    sessions,
    rememberPendingTerminalRef,
  });

  const {
    selectWorkspaceTab,
    diveWorkspaceTab,
    claimPointerZone,
    closeWorkspaceDocument,
    reopenWorkspaceDocument,
    closeWorkspaceTerminal,
    resumeWorkspaceTerminal,
    rememberLaunchedTaskAgent,
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
    cancelRestoration: () => {
      restoreRequestRef.current = null;
    },
    rememberPendingTerminalRef,
  });

  useTaskWorkspaceTabNavigation({
    tabs: bucket ? navigableTabs : [],
    activeTab,
    highlightedTab,
    highlightTab: setHighlightedTab,
    selectTab: selectWorkspaceTab,
    diveTab: diveWorkspaceTab,
    engageTab: engageWorkspaceTab,
    launcherTriggerRef,
    onBeforeFirst: onBeforeFirstTab,
    modal,
  });

  if (!bucket) return <div className="text-text-muted">No task selected</div>;

  const showZoneChrome = isEditView && navigationModality === "keyboard";
  const bodyEngaged = isEditView && editViewBodyEngaged;
  const showTabHighlight = showZoneChrome && editViewZone === "tab-strip";
  const allowTabHoverEmphasis =
    !isEditView ||
    navigationModality === "pointer" ||
    editViewZone === "tab-strip";

  return (
    <div
      ref={paneRef}
      data-coach-anchor="workspace"
      className="flex h-full flex-col"
    >
      <WorkspaceTabStrip
        tabStripRef={tabStripRef}
        launcherTriggerRef={launcherTriggerRef}
        isEditView={isEditView}
        editViewZone={editViewZone}
        showZoneChrome={showZoneChrome}
        allowTabHoverEmphasis={allowTabHoverEmphasis}
        showTabHighlight={showTabHighlight}
        highlightedTab={highlightedTab}
        activeKind={effActive}
        activeDoc={activeDoc}
        activeTerminalId={activeTermId}
        documents={openDocs}
        terminalTabs={tabs}
        orderedTabs={navigableTabs}
        activeTab={activeTab}
        reorderDrag={workspaceTabReorder}
        bucket={bucket}
        launchContext={launchContext}
        onClaimPointerZone={claimPointerZone}
        onSetEditViewZone={setEditViewZone}
        onSelectTab={selectWorkspaceTab}
        onCloseDocument={closeWorkspaceDocument}
        onCloseTerminal={closeWorkspaceTerminal}
        onTaskAgentLaunched={rememberLaunchedTaskAgent}
      />

      <DormantWorkspaceTabs
        closedDocuments={closedDocs}
        resumableSessions={resumable}
        resumableChips={dormantChips.resumable}
        historyChips={dormantChips.history}
        resumingRunIds={resumingRunIds}
        onReopenDocument={reopenWorkspaceDocument}
        onResumeTerminal={(session) => void resumeWorkspaceTerminal(session)}
      />

      <WorkspaceTabBody
        bodyRef={bodyRef}
        detailsSurfaceRef={detailsSurfaceRef}
        bucket={bucket}
        moduleId={moduleId}
        owner={owner}
        details={details}
        activeKind={effActive}
        activeDocument={activeDoc}
        openDocuments={openDocs}
        terminalIds={termIds}
        activeTerminalId={activeTermId}
        requestedSurface={requestedSurfaceRef.current}
        surfaceFocusSignal={surfaceFocusSignal}
        requestedTerminalId={requestedTerminalRef.current}
        terminalFocusSignal={terminalFocusSignal}
        activeTab={activeTab}
        isEditView={isEditView}
        editViewZone={editViewZone}
        showZoneChrome={showZoneChrome}
        bodyEngaged={bodyEngaged}
        onClaimPointerZone={claimPointerZone}
        onEngageTab={engageWorkspaceTab}
        onSetEditViewZone={setEditViewZone}
      />
    </div>
  );
}
