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
import { useWorkspaceDocuments } from "./documents/queries";
import {
  bucketOfMeta,
  isScratchBucket,
  useActiveSession,
  useResumableTerminalSessions,
  useTaskSessions,
  useTerminalStore,
  usePersistedTerminalSessions,
  useScratchTerminalSessions,
  useWorkspaceTabsStore,
  type ForegroundOwner,
  type SessionMeta,
} from "../../../../features/agents/terminal";
import {
  DEFAULT_WORKSPACE,
  useClientStore as useTicketWorkspaceStore,
} from "../../../../state/clientStore";
import { closeTerminalTab } from "./internal/closeTerminalTab";
import { terminalLabel } from "./internal/terminalLabel";
import type { LifecycleState } from "../../../../features/agents/terminal";
import type {
  Profile,
  ResumableTerminalSession,
} from "../../../../features/agents/types";
import {
  ApiError as AgentApiError,
  resumeTerminal,
} from "../../../../features/agents/api/agentApi";
import { LifecycleBadge } from "../../../../features/agents/terminal";
import {
  useTaskWorkspaceTabNavigation,
  type TaskWorkspaceTabIdentity,
} from "./internal/useTaskWorkspaceTabNavigation";
import {
  providerListPlaceholder,
  useActivatedProviders,
} from "../../../../features/workflows/launchProviderCatalog";
import {
  isSidebarEnabled,
  useConfig,
} from "../../../../features/studio/stores/configStore";
import { toast, useClientStore } from "../../../../state/clientStore";
import { formatChordSymbols } from "../../../navigation/chordLabel";
import { EDIT_VIEW_BODY_DISENGAGE_CHORD } from "../../../navigation/three-zone/threeZoneNavigation";
import { selectScratchRunIds, useAgentStatusStore } from "../../../../features/agents/status";
import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";
import {
  closeChatTab,
  launchChatSession,
  reopenChatTab,
  selectChatSession,
  useActiveChatSession,
  useChatStore,
  usePersistedChatSessions,
  useTaskChatSessions,
  type ChatSessionSummary,
} from "../../../../features/agents/chat";

const AVAILABLE_AGENTS: SessionMeta["agent"][] = ["claude", "agy", "codex", "gemini"];
// Versioned key (client-localstorage-schema): bump the suffix on shape
// changes and migrate in readStudioWorkspacesValue.
const STUDIO_WORKSPACES_KEY = "studio.activeWorkspaceByBucket:v2";
const LEGACY_STUDIO_WORKSPACES_KEYS = [
  "studio.activeWorkspaceByBucket:v1",
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
  | { kind: "terminal"; agentRunId: string }
  | { kind: "chat"; agentRunId: string };

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
  if (target.kind === "chat" && typeof target.agentRunId === "string") {
    return { kind: "chat", agentRunId: target.agentRunId };
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

function resumeErrorMessage(error: unknown): string {
  const body = error instanceof AgentApiError ? error.body : null;
  const detail = body && typeof body === "object"
    ? (body as { detail?: unknown }).detail
    : null;
  const code = detail && typeof detail === "object" && "error" in detail
    ? String((detail as { error?: unknown }).error)
    : body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error)
      : "";
  if (code === "cwd_missing") return "Working directory no longer exists";
  if (code === "run_still_active") return "Session is still running - attach instead";
  if (code === "resume_unsupported") return "This agent cannot resume sessions";
  return "Could not resume session";
}

// Stable loader shared by the lazy boundary and the launcher's intent
// preload, so hovering/focusing the launcher starts the (large) terminal
// chunk download before a run is actually started.
const loadSelectedTicketTerminal = () =>
  import("./terminals/SelectedTicketTerminal");
const SelectedTicketTerminal = lazy(async () => ({
  default: (await loadSelectedTicketTerminal()).SelectedTicketTerminal,
}));
const loadSelectedTicketChat = () =>
  import("../../../../features/agents/chat/ChatHost");
const SelectedTicketChat = lazy(async () => ({
  default: (await loadSelectedTicketChat()).ChatHost,
}));
const WorkspaceDocument = lazy(async () => ({
  default: (await import("./documents/WorkspaceDocument")).WorkspaceDocument,
}));

/** Taskless scratch run intents offered by the scratch launcher menu. */
export type ScratchLaunchMode = "plan" | "instant";

export interface TicketLaunchContext {
  projectId: string;
  moduleId: string | null;
  taskId: string;
  taskKey: string;
  taskName: string;
  ticketSeq: number | null;
  profileReady: boolean;
  profile: Profile | null;
}

/**
 * The tab strip's `＋ Agent` capability, discriminated by workspace kind
 * (CODIN-1020): a task workspace lists providers directly and launches a
 * task-bound run; a scratch workspace asks for the run mode first and hands
 * mode selection back to its host, which owns module choice and the shared
 * folder → prompt → provider create flow.
 */
export type WorkspaceLauncherContext =
  | ({ kind: "task" } & TicketLaunchContext)
  | {
      kind: "scratch";
      profileReady: boolean;
      onChooseMode: (mode: ScratchLaunchMode) => void;
    };

function Tab({
  id,
  controls,
  label,
  active,
  highlighted,
  allowHoverEmphasis,
  dim,
  lifecycle,
  onClick,
  onClose,
  closeLabel,
  closeDisabled,
}: {
  id: string;
  controls: string;
  label: string;
  active: boolean;
  highlighted?: boolean;
  allowHoverEmphasis: boolean;
  dim?: boolean;
  lifecycle?: LifecycleState;
  onClick: () => void;
  onClose?: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
}) {
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    const tabs = Array.from(
      event.currentTarget
        .closest<HTMLElement>("[role=tablist]")
        ?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [],
    );
    const current = tabs.indexOf(event.currentTarget);
    if (current < 0 || tabs.length === 0) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
    tabs[next].focus({ preventScroll: true });
  }

  return (
    <div
      data-highlighted={highlighted || undefined}
      className={`flex shrink-0 items-center border text-xs ${
        active
          ? "border-focus-accent bg-pane-title text-text-primary"
          : `border-pane-border bg-pane-bg text-text-muted ${
              allowHoverEmphasis ? "hover:bg-pane-title" : ""
            }`
      } ${highlighted ? "ring-1 ring-focus-accent ring-inset" : ""} ${
        dim ? "opacity-60" : ""
      }`}
    >
      <button
        id={id}
        type="button"
        role="tab"
        aria-label={label}
        aria-selected={active}
        aria-controls={controls}
        tabIndex={active ? 0 : -1}
        onClick={onClick}
        onKeyDown={onTabKeyDown}
        className={`flex items-center gap-2 px-2 py-0.5 outline-none ${
          allowHoverEmphasis ? "hover:bg-pane-title" : ""
        }`}
      >
        <span>{label}</span>
        {/* Attention axis — distinct from the tab's selected/dim transport cues. */}
        {lifecycle && <LifecycleBadge state={lifecycle} />}
      </button>
      {onClose && (
        <button
          type="button"
          disabled={closeDisabled}
          onClick={onClose}
          className="pr-2 text-text-muted hover:text-text-primary disabled:cursor-wait disabled:opacity-40"
          aria-label={closeLabel ?? `Close ${label}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

function workspaceElementId(
  bucket: string,
  part: "tab" | "panel",
  kind: TaskWorkspaceTabIdentity["kind"],
  id?: string,
): string {
  return ["workspace", part, bucket, kind, id]
    .filter((value): value is string => Boolean(value))
    .join("-")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * The per-ticket right pane: a tab strip (pinned Details, closable Doc, Chat,
 * and terminal tabs) plus a chip row (reopen-doc chip when the doc is
 * closed, inert history chips for terminated runs) over a content region.
 * TerminalHost and DocTab stay mounted so xterm instances and document
 * iframes persist across tab switches. Only the selected Chat mounts its
 * replay socket; ended or dismissed Chats remain lightweight reopen chips.
 */
export function SelectedTicketContent({
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
  const scratch = isScratchBucket(bucket);
  const chatTabs = useTaskChatSessions(bucket && !scratch ? bucket : null);
  const activeChatIdOrNull = useActiveChatSession(
    bucket && !scratch ? bucket : null,
  );
  const chatSessions = useChatStore((state) => state.sessions);
  const persistedChatQuery = usePersistedChatSessions(
    bucket && !scratch ? bucket : null,
  );
  const persistedTerminalQuery = usePersistedTerminalSessions(
    bucket && !scratch ? bucket : null,
  );
  const scratchTerminalQuery = useScratchTerminalSessions(
    scratch ? projectId : null,
    scratch ? moduleId : null,
  );
  const persistedSessions = scratch
    ? scratchTerminalQuery.sessions
    : persistedTerminalQuery.sessions;
  const terminalSessionsFetched = scratch
    ? scratchTerminalQuery.isFetched
    : persistedTerminalQuery.isFetched;
  const resumableSessions = useResumableTerminalSessions(
    bucket && !scratch ? bucket : null,
    scratch ? projectId : null,
    scratch ? moduleId : null,
  );
  const focusSession = useTerminalStore((s) => s.focusSession);
  const openSession = useTerminalStore((s) => s.openSession);
  const mountedTaskRunIds = useAgentStatusStore((s) =>
    bucket && !isScratchBucket(bucket)
      ? Object.values(s.runs)
          .filter((run) => run.task_id === bucket && run.run_kind !== "chat")
          .map((run) => run.agent_run_id)
      : EMPTY_RUN_IDS,
  );
  const mountedTaskChatRunIds = useAgentStatusStore((s) =>
    bucket && !isScratchBucket(bucket)
      ? Object.values(s.runs)
          .filter((run) => run.task_id === bucket && run.run_kind === "chat")
          .map((run) => run.agent_run_id)
      : EMPTY_RUN_IDS,
  );
  const mountedScratchRunIds = useAgentStatusStore(
    useShallow((s) =>
      bucket && isScratchBucket(bucket) && projectId && moduleId
        ? selectScratchRunIds(s, projectId, moduleId)
        : EMPTY_RUN_IDS,
    ),
  );
  const workspaces = useTicketWorkspaceStore((s) => s.workspaces);
  const ensureWorkspace = useTicketWorkspaceStore((s) => s.ensureWorkspace);
  const setActive = useTicketWorkspaceStore((s) => s.setActive);
  const setActiveDoc = useTicketWorkspaceStore((s) => s.setActiveDoc);
  const closeDoc = useTicketWorkspaceStore((s) => s.closeDoc);
  const reopenDoc = useTicketWorkspaceStore((s) => s.reopenDoc);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const launchCommittedRef = useRef(false);
  const chatLaunchPendingRef = useRef(false);
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
  const observedChatRunsRef = useRef<{
    bucket: string | null;
    ids: Set<string>;
  }>({ bucket: null, ids: new Set() });
  const [surfaceFocusSignal, setSurfaceFocusSignal] = useState(0);
  const [chatLaunchPending, setChatLaunchPending] = useState(false);
  const [closingChatIds, setClosingChatIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [terminalFocusSignal, setTerminalFocusSignal] = useState(0);
  const [highlightedTab, setHighlightedTab] =
    useState<TaskWorkspaceTabIdentity>({ kind: "details" });
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const sidebarEnabled = isSidebarEnabled(useConfig());
  const editViewZone = useClientStore((state) => state.editViewZone);
  const editViewBodyEngaged = useClientStore(
    (state) => state.editViewBodyEngaged,
  );
  const navigationModality = useClientStore((state) => state.navigationModality);
  const setEditViewZone = useClientStore((state) => state.setEditViewZone);
  const setNavigationModality = useClientStore(
    (state) => state.setNavigationModality,
  );
  const setEditViewBodyEngaged = useClientStore(
    (state) => state.setEditViewBodyEngaged,
  );
  const pushToast = useClientStore((state) => state.pushToast);
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
    rememberPendingTerminalRef.current = false;
    restoreRequestRef.current = null;
    if (!bucket || owner !== "studio") return;
    const target = readStudioWorkspaceTarget(bucket);
    if (!target) return;
    // Keep Details visible while durable targets hydrate.

    restoreRequestRef.current = { bucket, generation, target };
    setActive(bucket, "details");
    if (target.kind === "details") restoreRequestRef.current = null;
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
        useWorkspaceTabsStore.getState().tabSelected(expectedBucket, sessionId);
        setActive(expectedBucket, "terminal");
        return;
      }
      if (!fallbackWhenMissing) return;
      restoreRequestRef.current = null;
      setActive(expectedBucket, "details");
      rememberStudioWorkspaceTarget(expectedBucket, { kind: "details" });
    },
    [owner, setActive],
  );

  useEffect(() => {
    if (!bucket || !persistedChatQuery.isFetched) return;
    const request = restoreRequestRef.current;
    if (
      owner !== "studio" ||
      request?.bucket !== bucket ||
      request.generation !== restoreGenerationRef.current ||
      request.target.kind !== "chat"
    ) {
      return;
    }
    const session = chatSessions[request.target.agentRunId];
    if (session?.task_id === bucket) {
      restoreRequestRef.current = null;
      selectChatSession(bucket, request.target.agentRunId);
      setActive(bucket, "chat");
      return;
    }
    // The durable list has completed and the remembered run is absent.
    restoreRequestRef.current = null;
    setActive(bucket, "details");
    rememberStudioWorkspaceTarget(bucket, { kind: "details" });
  }, [
    bucket,
    chatSessions,
    owner,
    persistedChatQuery.isFetched,
    setActive,
  ]);

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

  const documentQuery = useWorkspaceDocuments(
    bucket,
    projectId,
    moduleId,
    isScratchBucket(bucket),
  );

  useEffect(() => {
    if (!bucket || !documentQuery.isFetched) return;
    const request = restoreRequestRef.current;
    if (
      owner !== "studio" ||
      request?.bucket !== bucket ||
      request.generation !== restoreGenerationRef.current ||
      request.target.kind !== "doc"
    ) return;
    const relPath = request.target.relPath;
    const target = documentQuery.documents.find(
      (document) => document.rel_path === relPath,
    );
    restoreRequestRef.current = null;
    if (target) setActiveDoc(bucket, target.id);
    else {
      setActive(bucket, "details");
      rememberStudioWorkspaceTarget(bucket, { kind: "details" });
    }
  }, [
    bucket,
    documentQuery.documents,
    documentQuery.isFetched,
    owner,
    setActive,
    setActiveDoc,
  ]);

  useEffect(() => {
    if (!bucket || !terminalSessionsFetched) return;
    useTerminalStore.getState().restoreLiveSessions(bucket, persistedSessions);
    restoreTerminalTarget(bucket, restoreGenerationRef.current, true);
  }, [bucket, persistedSessions, restoreTerminalTarget, terminalSessionsFetched]);

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
    void queryClient.invalidateQueries({
      queryKey: scratchTarget
        ? queryKeys.terminalSessions.scratch(
            scratchTarget.projectId,
            scratchTarget.moduleId,
          )
        : queryKeys.terminalSessions.persisted(bucket),
    });
  }, [
    bucket,
    projectId,
    moduleId,
    mountedBucketRunIds,
  ]);

  // Chat runs have their own durable index and must never flow through the
  // terminal reattachment path. A status-bus addition only invalidates that
  // Chat index; its query hydrates the structured-session store.
  useEffect(() => {
    if (!bucket || isScratchBucket(bucket)) {
      observedChatRunsRef.current = { bucket, ids: new Set() };
      return;
    }
    const previous = observedChatRunsRef.current;
    const runAdded = previous.bucket === bucket &&
      mountedTaskChatRunIds.some((runId) => !previous.ids.has(runId));
    observedChatRunsRef.current = {
      bucket,
      ids: new Set(mountedTaskChatRunIds),
    };
    if (!runAdded) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.chatSessions.persisted(bucket),
    });
  }, [bucket, mountedTaskChatRunIds]);

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
  const chatIds = chatTabs.map((tab) => tab.id);
  const activeChatId = activeChatIdOrNull;
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
  const closedDocIds = new Set(ws.closedDocIds);
  const openDocs = documentQuery.documents.filter((doc) => !closedDocIds.has(doc.id));
  const closedDocs = documentQuery.documents.filter((doc) => closedDocIds.has(doc.id));
  // The API already caps this history, but retain the presentation bound at
  // the UI seam so a malformed response cannot grow the dormant chip row.
  const resumable = resumableSessions.slice(0, 10);
  const resumableRunIds = new Set(
    resumable.map((session) => session.agent_run_id),
  );
  const visibleHistory = useAgentStatusStore((state) => {
    if (!bucket) return [];
    return Object.values(state.runs).filter((run) =>
      (isScratchBucket(bucket)
        ? run.task_id === null && run.project_id === projectId && run.module_id === moduleId
        : run.task_id === bucket) &&
      run.run_kind !== "chat" &&
      (run.state === "exited" || run.state === "lost" || run.state === "error") &&
      !resumableRunIds.has(run.agent_run_id),
    );
  });
  const activeDoc =
    openDocs.find((d) => d.id === ws.activeDocId) ?? openDocs[0] ?? null;
  const visibleChatHistory = persistedChatQuery.sessions.filter(
    (summary) =>
      summary.task_id === bucket && !chatIds.includes(summary.agent_run_id),
  );

  // Active-tab fallback: a terminal/chat/doc selection with nothing to show falls
  // back to Details (the pinned tab is always renderable).
  let effActive = ws.active;
  if (effActive === "terminal" && (termIds.length === 0 || !activeTermId)) {
    effActive = "details";
  }
  if (effActive === "chat" && (chatIds.length === 0 || !activeChatId)) {
    effActive = "details";
  }
  if (effActive === "doc" && !activeDoc) effActive = "details";

  const navigableTabs: TaskWorkspaceTabIdentity[] = [
    { kind: "details" },
    ...openDocs.map((doc) => ({ kind: "doc" as const, id: doc.id })),
    ...chatIds.map((id) => ({ kind: "chat" as const, id })),
    ...termIds.map((id) => ({ kind: "terminal" as const, id })),
  ];
  const activeTab: TaskWorkspaceTabIdentity =
    effActive === "doc" && activeDoc
      ? { kind: "doc", id: activeDoc.id }
      : effActive === "terminal" && activeTermId
        ? { kind: "terminal", id: activeTermId }
        : effActive === "chat" && activeChatId
          ? { kind: "chat", id: activeChatId }
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
    activeDoc?.id,
    activeChatId,
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
    rememberPendingTerminalRef.current = false;
    if (tab.kind === "details") {
      setActive(bucket, "details");
      if (owner === "studio") {
        rememberStudioWorkspaceTarget(bucket, { kind: "details" });
      }
    } else if (tab.kind === "doc") {
      setActiveDoc(bucket, tab.id);
      const relPath = documentQuery.documents.find((document) => document.id === tab.id)?.rel_path;
      if (owner === "studio" && relPath) {
        rememberStudioWorkspaceTarget(bucket, { kind: "doc", relPath });
      }
    } else if (tab.kind === "chat") {
      selectChatSession(bucket, tab.id);
      setActive(bucket, "chat");
      if (owner === "studio") {
        rememberStudioWorkspaceTarget(bucket, {
          kind: "chat",
          agentRunId: tab.id,
        });
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
    // Selecting a tab keeps DOM focus in the ARIA tablist. Entering/focusing
    // the selected surface is a separate workspace-navigation action.
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
    const wasActive = effActive === "doc" && activeDoc?.id === docId;
    closeDoc(bucket, docId);
    if (owner === "studio" && wasActive) {
      rememberStudioWorkspaceTarget(bucket, { kind: "details" });
    }
  }

  function reopenWorkspaceDocument(docId: string): void {
    if (!bucket) return;
    reopenDoc(bucket, docId);
    const relPath = documentQuery.documents.find((document) => document.id === docId)?.rel_path;
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

  async function resumeWorkspaceTerminal(
    resumableSession: ResumableTerminalSession,
  ): Promise<void> {
    if (!bucket || !projectId || resumingRunId) return;
    setResumingRunId(resumableSession.agent_run_id);
    try {
      const resumed = await resumeTerminal(resumableSession.agent_run_id);
      const queryKey = queryKeys.terminalSessions.resumable(
        scratch ? null : bucket,
        scratch ? projectId : null,
        scratch ? moduleId : null,
      );
      queryClient.setQueryData<ResumableTerminalSession[]>(queryKey, (current) =>
        (current ?? []).filter(
          (candidate) =>
            candidate.agent_run_id !== resumableSession.agent_run_id,
        ));
      openSession({
        taskId: scratch ? null : bucket,
        projectId,
        moduleId: moduleId ?? undefined,
        agent: resumableSession.agent,
        ticketSeq: null,
        agentRunId: resumed.agent_run_id,
        isPlanning: resumableSession.scope === "plan",
        isInstant: resumableSession.scope === "instant",
      });
      setActive(bucket, "terminal");
      if (owner === "studio") {
        rememberStudioWorkspaceTarget(bucket, {
          kind: "terminal",
          agentRunId: resumed.agent_run_id,
        });
      }
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({
        queryKey: scratch
          ? queryKeys.terminalSessions.scratch(projectId, moduleId)
          : queryKeys.terminalSessions.persisted(bucket),
      });
    } catch (error) {
      toast.error(resumeErrorMessage(error));
    } finally {
      setResumingRunId(null);
    }
  }

  async function closeWorkspaceChat(agentRunId: string): Promise<void> {
    if (!bucket) return;
    const taskBucket = bucket;
    if (closingChatIds.has(agentRunId)) return;
    setClosingChatIds((current) => new Set(current).add(agentRunId));
    try {
      await closeChatTab(taskBucket, agentRunId);
      const workspace = useTicketWorkspaceStore.getState().workspaces[taskBucket];
      const selectedChat = useChatStore.getState().activeByTask[taskBucket];
      if (workspace?.active === "chat" && !selectedChat) {
        setActive(taskBucket, "details");
        if (owner === "studio") {
          rememberStudioWorkspaceTarget(taskBucket, { kind: "details" });
        }
      }
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error
          ? `Could not close Codex Chat: ${error.message}`
          : "Could not close Codex Chat",
      );
    } finally {
      setClosingChatIds((current) => {
        const next = new Set(current);
        next.delete(agentRunId);
        return next;
      });
    }
  }

  function reopenWorkspaceChat(summary: ChatSessionSummary): void {
    if (!bucket) return;
    reopenChatTab(summary);
    selectChatSession(bucket, summary.agent_run_id);
    setActive(bucket, "chat");
    if (owner === "studio") {
      rememberStudioWorkspaceTarget(bucket, {
        kind: "chat",
        agentRunId: summary.agent_run_id,
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
  const launcherItems: Array<{
    id: string;
    label: string;
    kind: "scratch" | "terminal" | "chat";
    agent?: SessionMeta["agent"];
  }> =
    launchContext?.kind === "scratch"
      ? [
          { id: "plan", label: "Plan", kind: "scratch" },
          { id: "instant", label: "Instant", kind: "scratch" },
        ]
      : AVAILABLE_AGENTS.filter((agent) => activatedProviders.has(agent))
          .flatMap((agent) => {
            const provider = `${agent[0].toUpperCase()}${agent.slice(1)}`;
            const terminal = {
              id: `terminal:${agent}`,
              label: `${provider} · Terminal`,
              kind: "terminal" as const,
              agent,
            };
            return agent === "codex"
              ? [{
                  id: "chat:codex",
                  label: "Codex · Chat",
                  kind: "chat" as const,
                  agent,
                }, terminal]
              : [terminal];
          });
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

  function activateLauncherItem(item: (typeof launcherItems)[number]) {
    if (item.kind === "chat" && chatLaunchPendingRef.current) return;
    if (launchCommittedRef.current) return;
    launchCommittedRef.current = true;
    setLaunchOpen(false);
    if (!launchContext || !bucket) return;
    if (launchContext.kind === "scratch") {
      launchContext.onChooseMode(item.id as ScratchLaunchMode);
      return;
    }
    if (item.kind === "chat") {
      if (!launchContext.moduleId) {
        pushToast("error", "This issue needs a module before Chat can start.");
        return;
      }
      chatLaunchPendingRef.current = true;
      setChatLaunchPending(true);
      void launchChatSession({
        agent: "codex",
        project_id: launchContext.projectId,
        module_id: launchContext.moduleId,
        task_id: launchContext.taskId,
        initial_prompt: null,
        is_planning: false,
        is_instant: false,
        instant_prompt: null,
      }).then((agentRunId) => {
        selectChatSession(bucket, agentRunId);
        setActive(bucket, "chat");
        if (owner === "studio") {
          rememberStudioWorkspaceTarget(bucket, {
            kind: "chat",
            agentRunId,
          });
        }
      }).catch((error: unknown) => {
        pushToast(
          "error",
          error instanceof Error ? error.message : "Could not start Codex Chat",
        );
      }).finally(() => {
        chatLaunchPendingRef.current = false;
        setChatLaunchPending(false);
      });
      return;
    }
    openSession({
      taskId: launchContext.taskId,
      projectId: launchContext.projectId,
      moduleId: launchContext.moduleId ?? undefined,
      agent: item.agent ?? "codex",
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
          id={workspaceElementId(bucket, "tab", "details")}
          controls={workspaceElementId(bucket, "panel", "details")}
          label="Details"
          active={effActive === "details"}
          highlighted={showTabHighlight && highlightedTab.kind === "details"}
          allowHoverEmphasis={allowTabHoverEmphasis}
          onClick={() => selectWorkspaceTab({ kind: "details" })}
        />
        {openDocs.map((d) => (
          <Tab
            key={d.id}
            id={workspaceElementId(bucket, "tab", "doc", d.id)}
            controls={workspaceElementId(bucket, "panel", "doc", d.id)}
            label={d.label}
            active={effActive === "doc" && activeDoc?.id === d.id}
            highlighted={
              showTabHighlight &&
              highlightedTab.kind === "doc" &&
              highlightedTab.id === d.id
            }
            allowHoverEmphasis={allowTabHoverEmphasis}
            onClick={() => selectWorkspaceTab({ kind: "doc", id: d.id })}
            onClose={() => closeWorkspaceDocument(d.id)}
          />
        ))}
        {chatTabs.map(({ id, lifecycle }, index) => {
          const label = chatTabs.length === 1
            ? "Codex Chat"
            : `Codex Chat ${index + 1}`;
          return (
            <Tab
              key={id}
              id={workspaceElementId(bucket, "tab", "chat", id)}
              controls={workspaceElementId(bucket, "panel", "chat", id)}
              label={label}
              active={effActive === "chat" && activeChatId === id}
              highlighted={
                showTabHighlight &&
                highlightedTab.kind === "chat" &&
                highlightedTab.id === id
              }
              allowHoverEmphasis={allowTabHoverEmphasis}
              dim={lifecycle === "exited" || lifecycle === "error"}
              lifecycle={lifecycle}
              onClick={() => selectWorkspaceTab({ kind: "chat", id })}
              onClose={() => void closeWorkspaceChat(id)}
              closeLabel={`Close ${label}`}
              closeDisabled={closingChatIds.has(id)}
            />
          );
        })}
        {tabs.map(({ id, meta, lifecycle }) => (
          <Tab
            key={id}
            id={workspaceElementId(bucket, "tab", "terminal", id)}
            controls={workspaceElementId(bucket, "panel", "terminal")}
            label={terminalLabel(meta, ticketKey)}
            active={effActive === "terminal" && activeTermId === id}
            highlighted={
              showTabHighlight &&
              highlightedTab.kind === "terminal" &&
              highlightedTab.id === id
            }
            allowHoverEmphasis={allowTabHoverEmphasis}
            dim={lifecycle === "exited" || lifecycle === "lost" || lifecycle === "error"}
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
              onPointerEnter={() => {
                void loadSelectedTicketTerminal();
                void loadSelectedTicketChat();
              }}
              onFocus={() => {
                void loadSelectedTicketTerminal();
                void loadSelectedTicketChat();
              }}
              disabled={!canLaunch}
              aria-haspopup="menu"
              aria-expanded={launchOpen}
              title={
                canLaunch
                  ? launchContext.kind === "scratch"
                    ? "Start a new Plan or Instant run"
                    : "Start a Chat or Terminal agent run for this issue"
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
                      disabled={item.kind === "chat" && chatLaunchPending}
                      onClick={() => activateLauncherItem(item)}
                      className="px-3 py-1 text-left text-xs font-medium text-text-muted hover:bg-pane-title hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
                    >
                      {item.kind === "chat" && chatLaunchPending
                        ? "Codex · Chat (starting…)"
                        : item.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dormant chips: reopen docs/Chats, resume terminals, or show inert history. */}
      {(closedDocs.length > 0 ||
        resumable.length > 0 ||
        visibleChatHistory.length > 0 ||
        visibleHistory.length > 0) && (
        <div className="mb-1 flex shrink-0 flex-wrap gap-1">
          {closedDocs.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-label={`Reopen ${d.label}`}
              onClick={() => reopenWorkspaceDocument(d.id)}
              className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary"
            >
              + {d.label}
            </button>
          ))}
          {resumable.map((session) => (
            <button
              key={session.agent_run_id}
              type="button"
              aria-label={`Resume ${session.agent} terminal`}
              title={`Resume · ${session.started_at}`}
              disabled={resumingRunId !== null}
              onClick={() => void resumeWorkspaceTerminal(session)}
              className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
            >
              {resumingRunId === session.agent_run_id ? "Resuming…" : `↻ ${session.agent}`}
            </button>
          ))}
          {visibleChatHistory.map((summary, index) => {
            const label =
              visibleChatHistory.length === 1
                ? "Codex Chat"
                : `Codex Chat ${index + 1}`;
            return (
              <button
                key={summary.agent_run_id}
                type="button"
                aria-label={`Reopen ${label}`}
                onClick={() => reopenWorkspaceChat(summary)}
                className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary"
              >
                + {label}
              </button>
            );
          })}
          {visibleHistory.map((chip, i) => (
            <span
              key={`${chip.agent_run_id}-${i}`}
              title="Terminated run"
              className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted opacity-60"
            >
              {chip.agent ?? "Agent"} ✕
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
                  !useClientStore.getState().editViewBodyEngaged &&
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
          id={workspaceElementId(bucket, "panel", "details")}
          role="tabpanel"
          aria-labelledby={workspaceElementId(bucket, "tab", "details")}
          tabIndex={-1}
          data-testid="workspace-details-surface"
          className={
            effActive === "details"
              ? "absolute inset-0 overflow-auto"
              : "hidden"
          }
        >
          {details}
        </div>
        {/* One iframe per open document, kept mounted so switching docs
            or tabs never reloads them; visibility toggles per active doc. */}
        {openDocs.map((d) => (
          <div
            key={d.id}
            id={workspaceElementId(bucket, "panel", "doc", d.id)}
            role="tabpanel"
            aria-labelledby={workspaceElementId(bucket, "tab", "doc", d.id)}
            className={
              effActive === "doc" && activeDoc?.id === d.id
                ? "absolute inset-0"
                : "hidden"
            }
          >
            <Suspense fallback={null}>
              <WorkspaceDocument
                doc={d}
                focusSignal={
                  requestedSurfaceRef.current?.kind === "doc" &&
                  requestedSurfaceRef.current.id === d.id
                    ? surfaceFocusSignal
                    : 0
                }
              />
            </Suspense>
          </div>
        ))}
        {/* Keep lightweight tabpanels for ARIA association, but mount exactly
            one ChatHost/socket: the selected structured Chat. */}
        {chatIds.map((agentRunId) => (
          <div
            key={agentRunId}
            id={workspaceElementId(bucket, "panel", "chat", agentRunId)}
            role="tabpanel"
            aria-labelledby={workspaceElementId(bucket, "tab", "chat", agentRunId)}
            data-testid={`chat-host-wrapper-${agentRunId}`}
            className={
              effActive === "chat" && activeChatId === agentRunId
                ? "absolute inset-0"
                : "hidden"
            }
          >
            {activeChatId === agentRunId ? (
              <Suspense fallback={null}>
                <SelectedTicketChat
                  agentRunId={agentRunId}
                  focusSignal={
                    requestedSurfaceRef.current?.kind === "chat" &&
                    requestedSurfaceRef.current.id === agentRunId
                      ? surfaceFocusSignal
                      : 0
                  }
                />
              </Suspense>
            ) : null}
          </div>
        ))}
        {/* The single terminal host stays mounted across tab changes. Hidden
            with `invisible` (visibility:hidden) rather than `hidden`
            (display:none) so fit() never measures a zero-size container. */}
        <div
          id={workspaceElementId(bucket, "panel", "terminal")}
          role="tabpanel"
          aria-labelledby={
            activeTermId
              ? workspaceElementId(bucket, "tab", "terminal", activeTermId)
              : undefined
          }
          data-testid="terminal-host-wrapper"
          className={
            effActive === "terminal"
              ? "group absolute inset-0 flex flex-col"
              : "absolute inset-0 flex flex-col invisible pointer-events-none"
          }
        >
          <div className="relative min-h-0 flex-1">
            {termIds.length > 0 && (
              <Suspense fallback={null}>
                <SelectedTicketTerminal
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
                terminalEngaged ? "ring-2 ring-inset ring-lifecycle-success" : "opacity-0"
              }`}
            />
          )}
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
