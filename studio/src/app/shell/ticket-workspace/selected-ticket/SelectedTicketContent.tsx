import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkspaceDocuments } from "./documents/queries";
// Type-only: the review surface carries a syntax-highlighting diff renderer,
// so the shell must not pull the feature's runtime graph into its own chunk.
import type { CheckoutRef } from "../../../../features/source-control";
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
import {
  useRefreshWorkspaceTerminalSessionsForRuns,
  useWorkspaceTerminalSessions,
} from "./terminals/useWorkspaceTerminalSessions";
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
import { useActivatedProviders } from "../../../../features/workflows/launchProviderCatalog";
import { useWorkspaceTabOrder } from "../../../../features/workspace-tabs/queries";
import { useWorkspaceTabReorderDrag } from "../../../../features/workspace-tabs/internal/useWorkspaceTabReorderDrag";
import { workspaceTabIdentityKey } from "../../../../features/workspace-tabs/ordering";
import { useWorkspaceTabLifecycleOrder } from "../../../../features/workspace-tabs/useWorkspaceTabLifecycleOrder";

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
  parentId = null,
  owner,
  details,
  launchContext = null,
  entrySignal = 0,
  onBeforeFirstTab,
  modal = false,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  /** The task's parent, so a sub-task reviews the worktree it shares. */
  parentId?: string | null;
  owner: ForegroundOwner;
  details: ReactNode;
  launchContext?: WorkspaceLauncherContext | null;
  entrySignal?: number;
  onBeforeFirstTab?: () => void;
  /** True only when this workspace is hosted by the issue-drawer overlay. */
  modal?: boolean;
}) {
  const {
    sessions,
    tabs,
    activeTerminalId: activeTermIdOrNull,
    scratch,
    persistedSessions,
    terminalSessionsFetched,
    resumableSessions,
    mountedBucketRunIds,
  } = useWorkspaceTerminalSessions(bucket, projectId, moduleId);
  const {
    slugs: activatedProviders,
    loaded: providersLoaded,
    failed: providersFailed,
  } = useActivatedProviders();
  const ensureWorkspace = useTicketWorkspaceStore((s) => s.ensureWorkspace);
  const setActive = useTicketWorkspaceStore((s) => s.setActive);
  const setActiveDoc = useTicketWorkspaceStore((s) => s.setActiveDoc);
  const paneRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
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

  useStudioDocumentRestoration({
    bucket,
    owner,
    documents: documentQuery.documents,
    documentsFetched: documentQuery.isFetched,
    restoreRequestRef,
    restoreGenerationRef,
    setActive,
    setActiveDoc,
  });

  useEffect(() => {
    if (!bucket || !terminalSessionsFetched) return;
    useTerminalStore.getState().restoreLiveSessions(bucket, persistedSessions);
    restoreTerminalTarget(bucket, restoreGenerationRef.current, true);
  }, [
    bucket,
    mountedBucketRunIds,
    persistedSessions,
    restoreTerminalTarget,
    terminalSessionsFetched,
  ]);

  useRefreshWorkspaceTerminalSessionsForRuns({
    bucket,
    projectId,
    moduleId,
    mountedRunIds: mountedBucketRunIds,
  });

  const sessionByRun = useTerminalStore((s) => s.sessionByRun);
  const savedTabOrder = useWorkspaceTabOrder(
    bucket && !isScratchBucket(bucket) ? bucket : null,
  );
  // Changes is pinned for every workspace that owns a checkout, like Details:
  // a task workspace reviews its own worktree, and a module's scratch
  // workspace reviews that module's base checkout (ADR 0013). Nothing is read
  // from either until the tab is actually opened, so the tab's presence costs
  // no git.
  const reviewedCheckout: CheckoutRef | null = !bucket
    ? null
    : isScratchBucket(bucket)
      ? moduleId
        ? { kind: "module", moduleId }
        : null
      : { kind: "worktree", taskId: bucket, parentId, moduleId };
  const hasChanges = reviewedCheckout !== null;

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
    documents: documentQuery.documents,
    terminalTabs: tabs,
    activeTerminalId: activeTermId,
    resumableSessions,
    savedTabOrder: savedTabOrder.order,
    hasChanges,
  });

  const toPersistentTabIdentity = useCallback(
    (identity: TaskWorkspaceTabIdentity): TaskWorkspaceTabIdentity => {
      if (identity.kind !== "terminal") return identity;
      const terminal = tabs.find((tab) => tab.id === identity.id);
      return {
        kind: "terminal",
        id: terminal?.meta.agentRunId ?? identity.id,
      };
    },
    [tabs],
  );
  const knownPersistentTabs = useMemo(() => {
    const identities: TaskWorkspaceTabIdentity[] = [
      { kind: "details" },
      ...(hasChanges ? [{ kind: "changes" as const }] : []),
      ...documentQuery.documents.map((document) => ({
        kind: "doc" as const,
        id: document.id,
      })),
      ...persistedSessions.map((session) => ({
        kind: "terminal" as const,
        id: session.agent_run_id,
      })),
      ...resumableSessions.map((session) => ({
        kind: "terminal" as const,
        id: session.agent_run_id,
      })),
      ...tabs.map((tab) => ({
        kind: "terminal" as const,
        id: tab.meta.agentRunId ?? tab.id,
      })),
    ];
    return [...new Map(
      identities.map((identity) => [workspaceTabIdentityKey(identity), identity]),
    ).values()];
  }, [
    documentQuery.documents,
    hasChanges,
    persistedSessions,
    resumableSessions,
    tabs,
  ]);
  const workspaceTabReorder = useWorkspaceTabReorderDrag({
    workItemId: bucket && !isScratchBucket(bucket) ? bucket : null,
    visibleOrder: navigableTabs,
    savedOrder: savedTabOrder,
    knownIdentities: knownPersistentTabs,
    toPersistentIdentity: toPersistentTabIdentity,
  });
  useWorkspaceTabLifecycleOrder({
    workItemId: bucket && !isScratchBucket(bucket) ? bucket : null,
    savedOrder: savedTabOrder.order,
    orderReady: savedTabOrder.isReady,
    visibleIdentities: [
      { kind: "details" },
      ...(hasChanges ? [{ kind: "changes" as const }] : []),
      ...openDocs.map((document) => ({
        kind: "doc" as const,
        id: document.id,
      })),
      ...tabs.flatMap((tab) =>
        tab.meta.agentRunId
          ? [{ kind: "terminal" as const, id: tab.meta.agentRunId }]
          : [],
      ),
    ],
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
    launchTaskAgent,
    resumingRunId,
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
    documents: documentQuery.documents,
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
        activatedProviders={activatedProviders}
        providersLoaded={providersLoaded}
        providersFailed={providersFailed}
        onClaimPointerZone={claimPointerZone}
        onSetEditViewZone={setEditViewZone}
        onSelectTab={selectWorkspaceTab}
        onCloseDocument={closeWorkspaceDocument}
        onCloseTerminal={closeWorkspaceTerminal}
        onLaunchTaskAgent={launchTaskAgent}
      />

      <DormantWorkspaceTabs
        closedDocuments={closedDocs}
        resumableSessions={resumable}
        resumableChips={dormantChips.resumable}
        historyChips={dormantChips.history}
        resumingRunId={resumingRunId}
        onReopenDocument={reopenWorkspaceDocument}
        onResumeTerminal={(session) => void resumeWorkspaceTerminal(session)}
      />

      <WorkspaceTabBody
        bodyRef={bodyRef}
        detailsSurfaceRef={detailsSurfaceRef}
        bucket={bucket}
        owner={owner}
        details={details}
        reviewedCheckout={reviewedCheckout}
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
