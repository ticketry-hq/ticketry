import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { getDocuments, getScratchDocuments } from "../../agents/api/agentApi";
import {
  bucketOfMeta,
  docChatKey,
  isScratchBucket,
  scratchResumableKey,
  useActiveSession,
  useTaskSessions,
  useTerminalStore,
  useWorkspaceTabsStore,
  type ForegroundOwner,
  type SessionMeta,
} from "../../agents/terminal";
import {
  DEFAULT_WORKSPACE,
  useIssueDrawerWorkspaceStore,
} from "./internal/drawerWorkspaceStore";
import {
  resumeTerminalTab,
} from "./workspaceActions";
import { closeTerminalTab } from "./closeTerminalTab";
import { terminalLabel } from "./terminalLabel";
import type { LifecycleState } from "../../agents/terminal";
import type { DrawerLaunchContext } from "./internal/drawerWorkspaceStore";
import { LifecycleBadge } from "../../agents/terminal";
import {
  useTaskWorkspaceTabNavigation,
  type TaskWorkspaceTabIdentity,
} from "./useTaskWorkspaceTabNavigation";
import {
  providerListPlaceholder,
  useActivatedProviders,
} from "../../workflows/launchProviderCatalog";
import {
  isSidebarEnabled,
  useConfigStore,
} from "../../studio/stores/configStore";
import { useUIStore } from "../../studio/stores/uiStore";
import { formatChordSymbols } from "../../../app/navigation/chordLabel";
import { EDIT_VIEW_BODY_DISENGAGE_CHORD } from "../../../app/navigation/three-zone/threeZoneNavigation";
import { selectScratchRunIds, useAgentStatusStore } from "../../agents/status";

const DRAWER_AGENTS: SessionMeta["agent"][] = ["claude", "agy", "codex", "gemini"];
// Versioned key (client-localstorage-schema): bump the suffix on shape
// changes and migrate in readStudioWorkspacesValue.
const STUDIO_WORKSPACES_KEY = "studio.activeWorkspaceByBucket:v1";
const LEGACY_STUDIO_WORKSPACES_KEYS = [
  "studio.studio.activeWorkspaceByBucket",
  "studio.coding.activeWorkspaceByBucket",
];
// One entry per work-item bucket ever opened would grow forever; keep the
// most recently touched entries only.
const MAX_WORKSPACE_ENTRIES = 100;
const EMPTY_RUN_IDS: string[] = [];

type StudioWorkspaceTarget =
  | { kind: "details" }
  | { kind: "doc"; relPath: string }
  | { kind: "terminal"; agentRunId: string };

function parseStudioWorkspaceTarget(value: unknown): StudioWorkspaceTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  if (target.kind === "details") return { kind: "details" };
  if (target.kind === "doc" && typeof target.relPath === "string") {
    return { kind: "doc", relPath: target.relPath };
  }
  if (target.kind === "terminal" && typeof target.agentRunId === "string") {
    return { kind: "terminal", agentRunId: target.agentRunId };
  }
  return null;
}

function readStudioWorkspacesValue(): string {
  const current = localStorage.getItem(STUDIO_WORKSPACES_KEY);
  if (current !== null) return current;
  for (const legacyKey of LEGACY_STUDIO_WORKSPACES_KEYS) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      localStorage.setItem(STUDIO_WORKSPACES_KEY, legacy);
      localStorage.removeItem(legacyKey);
      return legacy;
    }
  }
  return "{}";
}

function readStudioWorkspaceTarget(bucket: string): StudioWorkspaceTarget | null {
  try {
    const parsed = JSON.parse(readStudioWorkspacesValue());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parseStudioWorkspaceTarget((parsed as Record<string, unknown>)[bucket]);
  } catch {
    return null;
  }
}

function rememberStudioWorkspaceTarget(
  bucket: string,
  target: StudioWorkspaceTarget,
): void {
  try {
    const parsed = JSON.parse(readStudioWorkspacesValue());
    const current = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    // Re-insert the touched bucket last (insertion order = recency), then
    // drop the oldest entries beyond the cap.
    delete current[bucket];
    const entries = [...Object.entries(current), [bucket, target] as const];
    localStorage.setItem(
      STUDIO_WORKSPACES_KEY,
      JSON.stringify(
        Object.fromEntries(entries.slice(-MAX_WORKSPACE_ENTRIES)),
      ),
    );
  } catch {}
}

// Stable loader shared by the lazy boundary and the launcher's intent
// preload, so hovering/focusing the launcher starts the (large) terminal
// chunk download before a run is actually started.
const loadWorkspaceTerminalHost = () =>
  import("../../agents/terminal/WorkspaceTerminalHost");
const WorkspaceTerminalHost = lazy(async () => ({
  default: (await loadWorkspaceTerminalHost()).WorkspaceTerminalHost,
}));
const WorkspaceDocTab = lazy(async () => ({
  default: (await import("../../documents/WorkspaceDocTab")).WorkspaceDocTab,
}));

/** Taskless scratch run intents offered by the scratch launcher menu. */
export type ScratchLaunchMode = "plan" | "instant";

/**
 * The tab strip's `＋ Agent` capability, discriminated by workspace kind
 * (CODIN-1020): a task workspace lists providers directly and launches a
 * task-bound run; a scratch workspace asks for the run mode first and hands
 * mode selection back to its host, which owns module choice and the shared
 * folder → prompt → provider create flow.
 */
export type WorkspaceLauncherContext =
  | ({ kind: "task" } & DrawerLaunchContext)
  | {
      kind: "scratch";
      profileReady: boolean;
      onChooseMode: (mode: ScratchLaunchMode) => void;
    };

function Tab({
  label,
  active,
  highlighted,
  allowHoverEmphasis,
  dim,
  lifecycle,
  onClick,
  onClose,
  closeLabel,
}: {
  label: string;
  active: boolean;
  highlighted?: boolean;
  allowHoverEmphasis: boolean;
  dim?: boolean;
  lifecycle?: LifecycleState;
  onClick: () => void;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={label}
      data-highlighted={highlighted || undefined}
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-2 border px-2 py-0.5 text-xs ${
        active
          ? "border-focus-accent bg-pane-title text-text-primary"
          : `border-pane-border bg-pane-bg text-text-muted ${
              allowHoverEmphasis ? "hover:bg-pane-title" : ""
            }`
      } ${highlighted ? "ring-1 ring-focus-accent ring-inset" : ""} ${
        dim ? "opacity-60" : ""
      }`}
    >
      <span>{label}</span>
      {/* Attention axis — distinct from the tab's selected/dim transport cues. */}
      {lifecycle && <LifecycleBadge state={lifecycle} />}
      {onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-text-muted hover:text-text-primary"
          aria-label={closeLabel ?? `Close ${label}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * The per-ticket right pane: a tab strip (pinned Details, closable Doc, N
 * closable terminal tabs) plus a chip row (reopen-doc chip when the doc is
 * closed, inert history chips for terminated runs) over a content region.
 * TerminalHost and DocTab are rendered unconditionally so xterm instances and
 * the doc iframe persist across ticket switches; only visibility is toggled.
 */
export function WorkspacePane({
  bucket,
  projectId,
  moduleId,
  ticketKey,
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
  /** Live canonical key for a ticket workspace; absent for scratch or unresolved data. */
  ticketKey?: string;
  owner: ForegroundOwner;
  details: ReactNode;
  launchContext?: WorkspaceLauncherContext | null;
  entrySignal?: number;
  onBeforeFirstTab?: () => void;
  /** True only when this workspace is hosted by the issue-drawer overlay. */
  modal?: boolean;
}) {
  const sessions = useTerminalStore((s) => s.sessions);
  const {
    slugs: activatedProviders,
    loaded: providersLoaded,
    failed: providersFailed,
  } = useActivatedProviders();
  const tabs = useTaskSessions(bucket);
  const activeTermIdOrNull = useActiveSession(bucket);
  const chatByDoc = useWorkspaceTabsStore((s) => s.chatByDoc);
  const resumableSessions = useTerminalStore((s) =>
    isScratchBucket(bucket) && projectId && moduleId
      ? s.resumableSessions[scratchResumableKey(projectId, moduleId)]
      : bucket
        ? s.resumableSessions[bucket]
        : undefined,
  );
  const focusSession = useTerminalStore((s) => s.focusSession);
  const openSession = useTerminalStore((s) => s.openSession);
  const fetchPersistedSessions = useTerminalStore((s) => s.fetchPersistedSessions);
  const fetchScratchSessions = useTerminalStore((s) => s.fetchScratchSessions);
  const mountedTaskRunIds = useAgentStatusStore((s) =>
    bucket && !isScratchBucket(bucket)
      ? s.byTask[bucket] ?? EMPTY_RUN_IDS
      : EMPTY_RUN_IDS,
  );
  const mountedScratchRunIds = useAgentStatusStore(
    useShallow((s) =>
      bucket && isScratchBucket(bucket) && projectId && moduleId
        ? selectScratchRunIds(s, projectId, moduleId)
        : EMPTY_RUN_IDS,
    ),
  );
  const workspaces = useIssueDrawerWorkspaceStore((s) => s.workspaces);
  const ensureWorkspace = useIssueDrawerWorkspaceStore((s) => s.ensureWorkspace);
  const setActive = useIssueDrawerWorkspaceStore((s) => s.setActive);
  const setOverlayOpen = useIssueDrawerWorkspaceStore((s) => s.setOverlayOpen);
  const setActiveDoc = useIssueDrawerWorkspaceStore((s) => s.setActiveDoc);
  const closeDoc = useIssueDrawerWorkspaceStore((s) => s.closeDoc);
  const reopenDoc = useIssueDrawerWorkspaceStore((s) => s.reopenDoc);
  const hydrateDocs = useIssueDrawerWorkspaceStore((s) => s.hydrateDocs);
  const [launchOpen, setLaunchOpen] = useState(false);
  const launchCommittedRef = useRef(false);
  const launchTriggerRef = useRef<HTMLButtonElement>(null);
  const launchMenuRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const detailsSurfaceRef = useRef<HTMLDivElement>(null);
  const requestedSurfaceRef = useRef<TaskWorkspaceTabIdentity | null>(null);
  const requestedTerminalRef = useRef<string | null>(null);
  const restoreRequestRef = useRef<{
    bucket: string;
    generation: number;
    target: StudioWorkspaceTarget;
  } | null>(null);
  const restoreGenerationRef = useRef(0);
  const rememberPendingTerminalRef = useRef(false);
  const observedBucketRunsRef = useRef<{
    bucket: string | null;
    ids: Set<string>;
  }>({ bucket: null, ids: new Set() });
  const [surfaceFocusSignal, setSurfaceFocusSignal] = useState(0);
  // True while a remembered doc/terminal target is still hydrating; the
  // details surface stays hidden behind a stable skeleton instead of
  // flashing before the restored tab takes over (B9).
  const [restorePending, setRestorePending] = useState(false);
  const [terminalFocusSignal, setTerminalFocusSignal] = useState(0);
  const [highlightedTab, setHighlightedTab] =
    useState<TaskWorkspaceTabIdentity>({ kind: "details" });
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const sidebarEnabled = useConfigStore(isSidebarEnabled);
  const editViewZone = useUIStore((state) => state.editViewZone);
  const editViewBodyEngaged = useUIStore(
    (state) => state.editViewBodyEngaged,
  );
  const navigationModality = useUIStore((state) => state.navigationModality);
  const setEditViewZone = useUIStore((state) => state.setEditViewZone);
  const setNavigationModality = useUIStore(
    (state) => state.setNavigationModality,
  );
  const setEditViewBodyEngaged = useUIStore(
    (state) => state.setEditViewBodyEngaged,
  );
  const isEditView =
    owner === "studio" && (!sidebarEnabled || !sidebarVisible);

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

  useEffect(() => {
    // Reset restoration when the Studio workspace changes.

    const generation = ++restoreGenerationRef.current;
    requestedSurfaceRef.current = null;
    requestedTerminalRef.current = null;
    useWorkspaceTabsStore.setState({ focusRequest: null });
    rememberPendingTerminalRef.current = false;
    restoreRequestRef.current = null;
    setRestorePending(false);
    if (!bucket || owner !== "studio") return;
    const target = readStudioWorkspaceTarget(bucket);
    if (!target) return;
    // Keep Details visible while durable targets hydrate.

    restoreRequestRef.current = { bucket, generation, target };
    setActive(bucket, "details");
    if (target.kind === "details") restoreRequestRef.current = null;
    else setRestorePending(true);
  }, [bucket, owner, setActive]);

  const restoreTerminalTarget = useCallback(
    (
      expectedBucket: string,
      generation: number,
      fallbackWhenMissing: boolean,
    ): void => {
      const request = restoreRequestRef.current;
      if (
        owner !== "studio" ||
        request?.bucket !== expectedBucket ||
        request.generation !== generation ||
        request.target.kind !== "terminal"
      ) {
        return;
      }
      const sessionId = useTerminalStore.getState().sessionByRun[
        request.target.agentRunId
      ];
      const session = sessionId
        ? useTerminalStore.getState().sessions[sessionId]
        : null;
      if (session && bucketOfMeta(session) === expectedBucket) {
        restoreRequestRef.current = null;
        setRestorePending(false);
        useWorkspaceTabsStore.getState().tabSelected(expectedBucket, sessionId);
        setActive(expectedBucket, "terminal");
        return;
      }
      if (!fallbackWhenMissing) return;
      restoreRequestRef.current = null;
      setRestorePending(false);
      setActive(expectedBucket, "details");
      rememberStudioWorkspaceTarget(expectedBucket, { kind: "details" });
    },
    [owner, setActive],
  );

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

  // The launcher menu never survives a workspace-context change: switching
  // bucket or launcher kind must not leave a hidden launch in progress.
  useEffect(() => {
    setLaunchOpen(false);
    launchCommittedRef.current = false;
  }, [bucket, launchContext?.kind]);

  // While open: focus lands on the first menu item, and a pointer press
  // outside the trigger/menu dismisses without consuming the outside action.
  useEffect(() => {
    if (!launchOpen) return;
    launchMenuRef.current
      ?.querySelector<HTMLButtonElement>("[role=menuitem]")
      ?.focus();
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        launchMenuRef.current?.contains(target) ||
        launchTriggerRef.current?.contains(target)
      )
        return;
      setLaunchOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [launchOpen]);

  // Restore document tabs from the registry (+ server-side rescan) whenever
  // the bucket opens — the reload/restart/run-completion restore path (#521).
  useEffect(() => {
    if (!bucket) return;
    const load =
      isScratchBucket(bucket)
        ? moduleId
          ? getScratchDocuments(moduleId)
          : null
        : getDocuments(bucket, projectId ?? undefined, moduleId ?? undefined);
    if (!load) return;
    void load
      .then((res) => {
        hydrateDocs(bucket, res.documents);
        // Resolve documents only after registry hydration.

        const request = restoreRequestRef.current;
        if (
          owner !== "studio" ||
          request?.bucket !== bucket ||
          request.generation !== restoreGenerationRef.current ||
          request.target.kind !== "doc"
        ) {
          return;
        }
        const relPath = request.target.relPath;
        const target = res.documents.find(
          (document) => document.rel_path === relPath,
        );
        restoreRequestRef.current = null;
        setRestorePending(false);
        if (target) {
          setActiveDoc(bucket, target.id);
        } else {
          setActive(bucket, "details");
          rememberStudioWorkspaceTarget(bucket, { kind: "details" });
        }
      })
      .catch(() => {
        const request = restoreRequestRef.current;
        if (
          owner !== "studio" ||
          request?.bucket !== bucket ||
          request.generation !== restoreGenerationRef.current ||
          request.target.kind !== "doc"
        ) {
          return;
        }
        restoreRequestRef.current = null;
        setRestorePending(false);
        setActive(bucket, "details");
      });
  }, [bucket, projectId, moduleId, owner, hydrateDocs, setActive, setActiveDoc]);

  // Fetch the selected bucket's persisted sessions; the fetch silently
  // re-attaches any tab that was live before a reload (auto-reattach trigger).
  // Real tickets list by task id; the scratch bucket lists no-task plan/instant
  // sessions by the selected project/module so they survive reload/restart too.
  useEffect(() => {
    const generation = restoreGenerationRef.current;
    const finishRestore = () => {
      if (bucket) restoreTerminalTarget(bucket, generation, true);
    };
    if (bucket && !isScratchBucket(bucket)) {
      void fetchPersistedSessions(bucket).then((outcome) => {
        if (outcome === "applied") finishRestore();
      });
    } else if (isScratchBucket(bucket) && projectId && moduleId) {
      void fetchScratchSessions(projectId, moduleId).then(finishRestore);
    }
  }, [
    bucket,
    projectId,
    moduleId,
    fetchPersistedSessions,
    fetchScratchSessions,
    restoreTerminalTarget,
  ]);

  // A run appearing for the mounted bucket is the one trigger to reconcile its
  // terminal tabs, so a spawn surfaces its tab without navigating away. The
  // re-fetch is the same one the mount effect above performs — task buckets by
  // task id, scratch buckets by project/module — and the restore path attaches
  // without selecting, so an arriving tab never steals the active one.
  const mountedBucketRunIds = isScratchBucket(bucket)
    ? mountedScratchRunIds
    : mountedTaskRunIds;
  useEffect(() => {
    const scratchTarget =
      isScratchBucket(bucket) && projectId && moduleId
        ? { projectId, moduleId }
        : null;
    if (!bucket || (isScratchBucket(bucket) && !scratchTarget)) {
      observedBucketRunsRef.current = { bucket, ids: new Set() };
      return;
    }
    const previous = observedBucketRunsRef.current;
    const runAdded =
      previous.bucket === bucket &&
      mountedBucketRunIds.some((runId) => !previous.ids.has(runId));
    observedBucketRunsRef.current = { bucket, ids: new Set(mountedBucketRunIds) };
    if (!runAdded) return;
    if (scratchTarget) {
      void fetchScratchSessions(scratchTarget.projectId, scratchTarget.moduleId);
    } else {
      void fetchPersistedSessions(bucket);
    }
  }, [
    bucket,
    projectId,
    moduleId,
    fetchPersistedSessions,
    fetchScratchSessions,
    mountedBucketRunIds,
  ]);

  const sessionByRun = useTerminalStore((s) => s.sessionByRun);

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

  const ws = bucket
    ? workspaces[bucket] ?? DEFAULT_WORKSPACE
    : DEFAULT_WORKSPACE;
  const termIds = tabs.map((t) => t.id);
  const activeTermId = activeTermIdOrNull;
  useEffect(() => {
    const requestedId = requestedTerminalRef.current;
    if (!activeTermId || !requestedId?.startsWith("tmp_") || sessions[requestedId]) {
      return;
    }
    // Ready rekeys tmp → server id; keep the pending terminal-focus request on
    // the same active tab so that identity change cannot consume its signal.
    requestedTerminalRef.current = activeTermId;
    setTerminalFocusSignal((signal) => signal + 1);
  }, [activeTermId, sessions]);
  const openDocs = ws.docs.filter((d) => d.open);
  const closedDocs = ws.docs.filter((d) => !d.open);
  // The API already selects the newest ten, but retain the presentation bound
  // at the UI seam too: a stale or malformed response must never let Scratch
  // chips grow without bound.
  const resumable = (resumableSessions ?? []).slice(0, 10);
  const resumableRunIds = new Set(resumable.map((session) => session.agent_run_id));
  const visibleHistory = ws.history.filter(
    (chip) => !chip.agentRunId || !resumableRunIds.has(chip.agentRunId),
  );
  const activeDoc =
    openDocs.find((d) => d.docId === ws.activeDocId) ?? openDocs[0] ?? null;

  // Active-tab fallback: a terminal/doc selection with nothing to show falls
  // back to Details (the pinned tab is always renderable).
  let effActive = ws.active;
  if (effActive === "terminal" && (termIds.length === 0 || !activeTermId)) {
    effActive = "details";
  }
  if (effActive === "doc" && !activeDoc) effActive = "details";

  const navigableTabs: TaskWorkspaceTabIdentity[] = [
    { kind: "details" },
    ...openDocs.map((doc) => ({ kind: "doc" as const, id: doc.docId })),
    ...termIds.map((id) => ({ kind: "terminal" as const, id })),
  ];
  const activeTab: TaskWorkspaceTabIdentity =
    effActive === "doc" && activeDoc
      ? { kind: "doc", id: activeDoc.docId }
      : effActive === "terminal" && activeTermId
        ? { kind: "terminal", id: activeTermId }
        : { kind: "details" };

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
  ]);

  useEffect(() => {
    if (!isEditView) return;
    if (editViewZone === "tab-strip") {
      if (document.activeElement !== tabStripRef.current) {
        tabStripRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (editViewZone !== "active-tab-body") return;
    if (document.activeElement !== bodyRef.current) {
      bodyRef.current?.focus({ preventScroll: true });
    }
  }, [
    editViewZone,
    isEditView,
  ]);

  useEffect(() => {
    if (!isEditView || editViewZone !== "tab-strip") return;
    setHighlightedTab(activeTab);
  }, [
    activeDoc?.docId,
    activeTermId,
    bucket,
    editViewZone,
    effActive,
    isEditView,
  ]);

  useEffect(() => {
    if (
      owner !== "studio" ||
      !bucket ||
      !rememberPendingTerminalRef.current ||
      !activeTermId
    ) {
      return;
    }
    const agentRunId = sessions[activeTermId]?.agentRunId;
    if (!agentRunId) return;
    // Persist after the launched session gains durable identity.

    rememberPendingTerminalRef.current = false;
    rememberStudioWorkspaceTarget(bucket, { kind: "terminal", agentRunId });
  }, [activeTermId, bucket, owner, sessions]);

  function selectWorkspaceTab(tab: TaskWorkspaceTabIdentity): void {
    if (!bucket) return;
    restoreRequestRef.current = null;
    setRestorePending(false);
    rememberPendingTerminalRef.current = false;
    if (tab.kind === "details") {
      setActive(bucket, "details");
      if (owner === "studio") {
        rememberStudioWorkspaceTarget(bucket, { kind: "details" });
      }
    } else if (tab.kind === "doc") {
      setActiveDoc(bucket, tab.id);
      const relPath = ws.docs.find((document) => document.docId === tab.id)?.relPath;
      if (owner === "studio" && relPath) {
        rememberStudioWorkspaceTarget(bucket, { kind: "doc", relPath });
      }
    } else {
      focusSession(tab.id);
      setActive(bucket, "terminal");
      const agentRunId = sessions[tab.id]?.agentRunId;
      if (owner === "studio" && agentRunId) {
        rememberStudioWorkspaceTarget(bucket, { kind: "terminal", agentRunId });
      } else if (owner === "studio") {
        rememberPendingTerminalRef.current = true;
      }
    }
    if (!isEditView) engageWorkspaceTab(tab);
  }

  function diveWorkspaceTab(
    tab: TaskWorkspaceTabIdentity,
    activate: boolean,
  ): void {
    setEditViewZone("active-tab-body");
    if (activate) selectWorkspaceTab(tab);
  }

  function claimPointerZone(zone: "tab-strip" | "active-tab-body"): void {
    setNavigationModality("pointer");
    setEditViewZone(zone);
  }

  function closeWorkspaceDocument(docId: string): void {
    if (!bucket) return;
    const wasActive = effActive === "doc" && activeDoc?.docId === docId;
    closeDoc(bucket, docId);
    if (owner === "studio" && wasActive) {
      rememberStudioWorkspaceTarget(bucket, { kind: "details" });
    }
  }

  function reopenWorkspaceDocument(docId: string): void {
    if (!bucket) return;
    reopenDoc(bucket, docId);
    const relPath = ws.docs.find((document) => document.docId === docId)?.relPath;
    if (owner === "studio" && relPath) {
      rememberStudioWorkspaceTarget(bucket, { kind: "doc", relPath });
    }
  }

  function closeWorkspaceTerminal(sessionId: string): void {
    if (!bucket) return;
    if (
      owner === "studio" &&
      effActive === "terminal" &&
      activeTermId === sessionId
    ) {
      const index = termIds.indexOf(sessionId);
      const remaining = termIds.filter((id) => id !== sessionId);
      const nextSessionId = remaining[Math.min(index, remaining.length - 1)];
      const agentRunId = nextSessionId
        ? sessions[nextSessionId]?.agentRunId
        : null;
      rememberStudioWorkspaceTarget(
        bucket,
        agentRunId ? { kind: "terminal", agentRunId } : { kind: "details" },
      );
    }
    void closeTerminalTab(sessionId, bucket, ticketKey);
  }

  async function resumeWorkspaceTerminal(agentRunId: string): Promise<void> {
    if (!bucket) return;
    const restored = await resumeTerminalTab(
      bucket,
      bucket,
      agentRunId,
      projectId ?? undefined,
      moduleId ?? undefined,
    );
    if (!restored || owner !== "studio") return;
    const sessionId = useWorkspaceTabsStore.getState().activeByTask[bucket];
    const restoredRunId = sessionId
      ? useTerminalStore.getState().sessions[sessionId]?.agentRunId
      : null;
    if (restoredRunId) {
      rememberStudioWorkspaceTarget(bucket, {
        kind: "terminal",
        agentRunId: restoredRunId,
      });
    }
  }

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

  // Doc-agent overlay (#625): a ~75% window that dims the active doc and hosts
  // THAT document's dedicated doc-chat run (chatByDoc) in the single
  // TerminalHost. Per-document — shown only when the active doc's own overlay
  // flag is set; closing flips just that flag (background, not kill). The agent
  // label comes from the doc-chat session, not the tab strip.
  const overlayActive =
    effActive === "doc" && !!activeDoc && (ws.overlayOpenByDoc[activeDoc.docId] ?? false);
  const chatSessionId = activeDoc
    ? chatByDoc[docChatKey(bucket, activeDoc.relPath)]
    : undefined;
  const chatSession = chatSessionId ? sessions[chatSessionId] : null;
  const canLaunch = !!launchContext?.profileReady;
  const showZoneChrome = isEditView && navigationModality === "keyboard";
  // The ring cannot live on the terminal host wrapper: `ring-inset` is an
  // inset box-shadow, and xterm's own opaque host background paints over its
  // parent's shadow layer, so the ring was invisible. It goes on a
  // pointer-events-none overlay stacked above the terminal instead — the same
  // trick the `active-tab-body` navigation highlight already uses.
  // Keyboard navigation has two states on the active body that must never
  // look alike: the zone is *selected* but keys still drive navigation, versus
  // *entered*, where keys go to xterm and only Cmd+Escape gets back out.
  // Selection keeps the accent-blue cursor ring shared with every other zone;
  // entering switches to a green "live / input captured" ring, so the two
  // differ in hue, not just in weight. Engaged wins outright — the blue
  // selection ring is suppressed so no ambiguity survives.
  // None of this is pointer chrome: clicking into a terminal is already
  // self-evident, so the ring follows `showZoneChrome` and stays out of the
  // way whenever the mouse is what brought you here.
  const bodyEngaged = isEditView && editViewBodyEngaged;
  const terminalEngaged = bodyEngaged && effActive === "terminal";
  const showTerminalRing = showZoneChrome;
  // The pane host pads its body by 8px, so a ring drawn at the body's own edge
  // reads as hugging the terminal with dead panel space outside it. On the
  // full-pane terminal both rings span that padding instead, landing flush on
  // the pane's outer left/right/bottom edges (the top edge belongs to the tab
  // strip). The doc-chat overlay window keeps its own rounded bounds.
  const terminalRingBox =
    effActive === "terminal" ? "top-0 -bottom-2 -left-2 -right-2" : "inset-0";
  const showTabHighlight = showZoneChrome && editViewZone === "tab-strip";
  const allowTabHoverEmphasis =
    !isEditView ||
    navigationModality === "pointer" ||
    editViewZone === "tab-strip";

  // The shared menu's first grammar is fixed per launcher kind: providers for
  // a task workspace, Plan/Instant for a scratch workspace. The provider
  // grammar is filtered by host activation (ADR-0015) so a deactivated
  // provider is never offered here either.
  const launcherItems: { id: string; label: string }[] =
    launchContext?.kind === "scratch"
      ? [
          { id: "plan", label: "Plan" },
          { id: "instant", label: "Instant" },
        ]
      : DRAWER_AGENTS.filter((agent) => activatedProviders.has(agent))
          .map((agent) => ({ id: agent, label: agent }));
  // An empty provider list is ambiguous — not loaded yet, a dead fetch, and
  // "nothing activated" all look the same. Say which, rather than opening a
  // menu with nothing in it and no explanation.
  const launcherNotice =
    launchContext?.kind === "scratch" || launcherItems.length > 0
      ? null
      : providerListPlaceholder({
          loaded: providersLoaded,
          failed: providersFailed,
        });

  function activateLauncherItem(id: string) {
    if (launchCommittedRef.current) return;
    launchCommittedRef.current = true;
    setLaunchOpen(false);
    if (!launchContext || !bucket) return;
    if (launchContext.kind === "scratch") {
      launchContext.onChooseMode(id as ScratchLaunchMode);
      return;
    }
    openSession({
      taskId: launchContext.taskId,
      projectId: launchContext.projectId,
      moduleId: launchContext.moduleId ?? undefined,
      agent: id as SessionMeta["agent"],
      ticketSeq: launchContext.ticketSeq,
    });
    setActive(bucket, "terminal");
    if (owner === "studio") rememberPendingTerminalRef.current = true;
  }

  function onLauncherMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      launchMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role=menuitem]",
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(current + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setLaunchOpen(false);
      launchTriggerRef.current?.focus();
    }
  }

  return (
    <div
      ref={paneRef}
      data-coach-anchor="workspace"
      className="flex h-full flex-col"
    >
      <div
        ref={tabStripRef}
        role="tablist"
        aria-label="Workspace tabs"
        data-testid="workspace-tabs"
        data-navigation-zone={isEditView ? "tab-strip" : undefined}
        tabIndex={isEditView ? -1 : undefined}
        onMouseDown={
          isEditView ? () => claimPointerZone("tab-strip") : undefined
        }
        onFocus={
          isEditView ? () => setEditViewZone("tab-strip") : undefined
        }
        className={`mb-1 flex shrink-0 flex-wrap gap-1 border-b border-pane-border pb-1 outline-none transition-opacity duration-150 motion-reduce:transition-none ${
          isEditView
            ? `min-h-10 items-center px-1 py-1 ${
                showZoneChrome
                  ? editViewZone === "tab-strip"
                    ? "ring-1 ring-focus-accent ring-inset"
                    : "opacity-[0.65]"
                  : ""
              }`
            : ""
        }`}
      >
        {/* Pinned, non-closable Details tab. */}
        <Tab
          label="Details"
          active={effActive === "details"}
          highlighted={showTabHighlight && highlightedTab.kind === "details"}
          allowHoverEmphasis={allowTabHoverEmphasis}
          onClick={() => selectWorkspaceTab({ kind: "details" })}
        />
        {openDocs.map((d) => (
          <Tab
            key={d.docId}
            label={d.label}
            active={effActive === "doc" && activeDoc?.docId === d.docId}
            highlighted={
              showTabHighlight &&
              highlightedTab.kind === "doc" &&
              highlightedTab.id === d.docId
            }
            allowHoverEmphasis={allowTabHoverEmphasis}
            onClick={() => selectWorkspaceTab({ kind: "doc", id: d.docId })}
            onClose={() => closeWorkspaceDocument(d.docId)}
          />
        ))}
        {tabs.map(({ id, meta, lifecycle }) => (
          <Tab
            key={id}
            label={terminalLabel(meta, ticketKey)}
            active={effActive === "terminal" && activeTermId === id}
            highlighted={
              showTabHighlight &&
              highlightedTab.kind === "terminal" &&
              highlightedTab.id === id
            }
            allowHoverEmphasis={allowTabHoverEmphasis}
            dim={meta.status === "exited"}
            lifecycle={lifecycle}
            onClick={() => selectWorkspaceTab({ kind: "terminal", id })}
            onClose={() => closeWorkspaceTerminal(id)}
            closeLabel={`Close terminal ${terminalLabel(meta, ticketKey)}`}
          />
        ))}
        {launchContext && (
          <div className="relative">
            <button
              type="button"
              ref={launchTriggerRef}
              onClick={() =>
                setLaunchOpen((open) => {
                  if (!open) launchCommittedRef.current = false;
                  return !open;
                })
              }
              onPointerEnter={() => void loadWorkspaceTerminalHost()}
              onFocus={() => void loadWorkspaceTerminalHost()}
              disabled={!canLaunch}
              aria-haspopup="menu"
              aria-expanded={launchOpen}
              title={
                canLaunch
                  ? launchContext.kind === "scratch"
                    ? "Start a new Plan or Instant run"
                    : "Start a new agent run for this issue"
                  : "A ready Studio profile is required to launch a run"
              }
              className="flex shrink-0 items-center border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-focus-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-pane-border disabled:hover:text-text-muted"
            >
              ＋ Agent
            </button>
            {launchOpen && canLaunch && (
              <div
                ref={launchMenuRef}
                role="menu"
                aria-label="Launch agent"
                onKeyDown={onLauncherMenuKeyDown}
                className="absolute left-0 top-full z-10 mt-1 flex min-w-[10ch] flex-col border border-pane-border bg-pane-panel py-1 shadow-lg"
              >
                {launcherNotice ? (
                  <p className="px-3 py-1 text-xs text-text-muted">
                    {launcherNotice}
                  </p>
                ) : (
                  launcherItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => activateLauncherItem(item.id)}
                      className="px-3 py-1 text-left text-xs font-medium text-text-muted hover:bg-pane-title hover:text-text-primary"
                    >
                      {item.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dormant chips: reopen closed docs, resume runs, or inert terminated runs. */}
      {(closedDocs.length > 0 || visibleHistory.length > 0 || resumable.length > 0) && (
        <div className="mb-1 flex shrink-0 flex-wrap gap-1">
          {closedDocs.map((d) => (
            <button
              key={d.docId}
              type="button"
              aria-label={`Reopen ${d.label}`}
              onClick={() => reopenWorkspaceDocument(d.docId)}
              className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary"
            >
              + {d.label}
            </button>
          ))}
          {resumable.map((session) => (
            <button
              key={session.agent_run_id}
              type="button"
              title={`Resume · ${session.ended_at}`}
              onClick={() => void resumeWorkspaceTerminal(session.agent_run_id)}
              className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary"
            >
              ↻ {session.agent}
            </button>
          ))}
          {visibleHistory.map((chip, i) => (
            <span
              key={`${chip.agentRunId ?? "ephemeral"}-${i}`}
              title="Terminated run"
              className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted opacity-60"
            >
              {chip.label} ✕
            </span>
          ))}
        </div>
      )}

      <div
        ref={bodyRef}
        data-navigation-zone={isEditView ? "active-tab-body" : undefined}
        tabIndex={isEditView ? -1 : undefined}
        onMouseDown={
          isEditView
            ? (event) => {
                claimPointerZone("active-tab-body");
                if (event.target instanceof HTMLElement) {
                  engageWorkspaceTab(activeTab);
                }
              }
            : undefined
        }
        onFocus={
          isEditView ? () => setEditViewZone("active-tab-body") : undefined
        }
        onFocusCapture={
          isEditView
            ? (event) => {
                if (
                  !useUIStore.getState().editViewBodyEngaged &&
                  event.target instanceof HTMLElement &&
                  event.target.closest(".xterm")
                ) {
                  bodyRef.current?.focus({ preventScroll: true });
                }
              }
            : undefined
        }
        className={`relative min-h-0 flex-1 outline-none transition-opacity duration-150 motion-reduce:transition-none ${
          showZoneChrome && editViewZone !== "active-tab-body"
            ? "opacity-[0.65]"
            : ""
        }`}
      >
        <div
          ref={detailsSurfaceRef}
          tabIndex={-1}
          data-testid="workspace-details-surface"
          className={
            effActive === "details" && !restorePending
              ? "absolute inset-0 overflow-auto"
              : "hidden"
          }
        >
          {details}
        </div>
        {restorePending && effActive === "details" ? (
          <div
            data-testid="workspace-restore-skeleton"
            className="absolute inset-0 grid place-items-center text-sm text-text-muted"
          >
            Restoring workspace…
          </div>
        ) : null}
        {/* One iframe per open document, kept mounted so switching docs
            or tabs never reloads them; visibility toggles per active doc. */}
        {openDocs.map((d) => (
          <div
            key={d.docId}
            className={
              effActive === "doc" && activeDoc?.docId === d.docId
                ? "absolute inset-0"
                : "hidden"
            }
          >
            <Suspense fallback={null}>
              <WorkspaceDocTab
                doc={d}
                bucket={bucket}
                projectId={projectId}
                moduleId={moduleId}
                taskId={isScratchBucket(bucket) ? null : bucket}
                ticketSeq={
                  launchContext?.kind === "task" ? launchContext.ticketSeq : null
                }
                focusSignal={
                  requestedSurfaceRef.current?.kind === "doc" &&
                  requestedSurfaceRef.current.id === d.docId
                    ? surfaceFocusSignal
                    : 0
                }
              />
            </Suspense>
          </div>
        ))}
        {/* Overlay scrim (#625): dims the active doc behind the agent window.
            A separate element so the single TerminalHost is never re-parented
            (which would reset its session). Click-to-close, like the × button. */}
        {overlayActive && (
          <div
            role="presentation"
            onClick={() => activeDoc && setOverlayOpen(bucket, activeDoc.docId, false)}
            className="absolute inset-0 z-30 bg-black/50"
          />
        )}
        {/* The single terminal host has three presentations driven entirely by
            CSS so the xterm DOM is never re-parented (which would reset the
            session): a full pane on its own tab, a ~75% overlay window over a
            dimmed doc, or an invisible-but-measurable box otherwise. Hidden
            with `invisible` (visibility:hidden) rather than `hidden`
            (display:none) so fit() never measures a zero-size container. */}
        <div
          data-testid="terminal-host-wrapper"
          className={
            effActive === "terminal"
              ? "group absolute inset-0 flex flex-col"
              : overlayActive
                ? "group absolute inset-x-[12.5%] inset-y-[10%] z-40 flex flex-col overflow-hidden rounded-lg border border-pane-border bg-pane-bg shadow-2xl"
                : "absolute inset-0 flex flex-col invisible pointer-events-none"
          }
        >
          {overlayActive && (
            <div className="flex shrink-0 items-center gap-2 border-b border-pane-border bg-pane-title px-3 py-1.5 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full bg-green-400" />
              <span className="flex-1 truncate text-text-primary">
                agent · {chatSession?.agent ?? "doc-chat"}
                {activeDoc ? ` · ${activeDoc.label}` : ""}
              </span>
              <button
                type="button"
                onClick={() =>
                  activeDoc && setOverlayOpen(bucket, activeDoc.docId, false)
                }
                className="text-text-muted hover:text-text-primary"
                aria-label="Close agent overlay"
              >
                ×
              </button>
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {(termIds.length > 0 || overlayActive) && (
              <Suspense fallback={null}>
                <WorkspaceTerminalHost
                  bucket={bucket}
                  owner={owner}
                  focusSignal={
                    requestedTerminalRef.current === activeTermId
                      ? terminalFocusSignal
                      : 0
                  }
                />
              </Suspense>
            )}
          </div>
          {showTerminalRing && (
            <div
              aria-hidden="true"
              data-testid="terminal-mode-ring"
              data-terminal-mode={terminalEngaged ? "engaged" : "idle"}
              className={`pointer-events-none absolute ${terminalRingBox} z-50 ${
                overlayActive ? "rounded-lg" : ""
              } ${
                terminalEngaged ? "ring-2 ring-inset ring-lifecycle-success" : "opacity-0"
              }`}
            />
          )}
          {/* Full-pane presentation only: the agent overlay has its own title
              bar where this tag would otherwise land. */}
          {showZoneChrome && terminalEngaged && effActive === "terminal" && (
            <div
              data-testid="terminal-mode-tag"
              className="pointer-events-none absolute left-0 top-5 z-50 flex items-center gap-2 rounded-r border border-l-0 border-lifecycle-success/40 bg-pane-bg/90 px-3 py-1.5 text-sm shadow-sm"
            >
              <span className="font-bold text-lifecycle-success">
                {formatChordSymbols(EDIT_VIEW_BODY_DISENGAGE_CHORD)}
              </span>
              <span className="text-text-muted">— Disengage Body</span>
            </div>
          )}
        </div>
        {showZoneChrome && editViewZone === "active-tab-body" && !bodyEngaged && (
          <div
            aria-hidden="true"
            data-navigation-highlight="active-tab-body"
            className={`pointer-events-none absolute ${terminalRingBox} z-50 ring-1 ring-focus-accent ring-inset`}
          />
        )}
      </div>
    </div>
  );
}
