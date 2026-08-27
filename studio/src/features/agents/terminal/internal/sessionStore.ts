import { createApolloStore } from "../../../../shared/apollo/localState";
import * as api from "../../api/agentApi";
import {
  TEMP_TASK_ID,
  type SessionId,
  type TaskId,
} from "../../types";
import {
  foregroundKey,
  useTerminalForegroundStore,
} from "./foregroundStore";
import { useClientStore as useWorkspaceTabsStore } from "../../../../state/clientStore";
import { readVersionedItem } from "../../../../shared/storage/versioned";
import { readAgentStatusHolding } from "../../status/apolloHolding";
import type { RunRecord } from "../../status";
import { rekeyTerminalFocus } from "./terminalRegistry";
import { isTerminalProvider } from "../presentation/providerPresentation";

export type SessionStatus =
  | "connecting"
  | "ready"
  | "reconnecting"
  // A desktop viewer ended while the durable agent run may still be alive.
  // These are transport facts only; never infer a backend run exit from them.
  | "viewer_closed"
  | "pty_eof"
  | "exited"
  | "error"
  // Terminal: the attach target is gone for good (server restarted / tmux
  // session killed) — the backend answered a mount-attach with
  // `session_not_found` before closing (CODIN-799/800). Distinct from `error`
  // (a transient transport drop that may be retried) so the UI can offer no
  // retry and point the user at the durable facts instead.
  | "session_lost";

export type TerminalTransport = "connecting" | "ready" | "reconnecting" | "closed";

// App-scoped set of agent_run_ids whose tabs were live (reached `ready`).
// Persisted to localStorage so a reload can silently re-attach those sessions
// once ProjectRunStatus publishes their runs.
// Versioned key (client-localstorage-schema); reads migrate the legacy
// unversioned spelling once and require an array of strings.
const LIVE_RUNS_KEY = "muxed:live-agent-runs:v1";
const LEGACY_LIVE_RUNS_KEYS = ["muxed:live-agent-runs"];

function readLiveRuns(): Set<string> {
  try {
    const raw = readVersionedItem(LIVE_RUNS_KEY, LEGACY_LIVE_RUNS_KEYS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeLiveRuns(ids: Set<string>): void {
  try {
    localStorage.setItem(LIVE_RUNS_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable — auto-reattach simply won't survive reload */
  }
}

function addLiveRun(id: string): void {
  const ids = readLiveRuns();
  if (!ids.has(id)) {
    ids.add(id);
    writeLiveRuns(ids);
  }
}

function removeLiveRun(id: string | null): void {
  if (!id) return;
  const ids = readLiveRuns();
  if (ids.delete(id)) writeLiveRuns(ids);
}

// Agent run ids whose tab the user explicitly closed in this browser, keyed by
// workspace bucket. Closing a tab does not end the run, so the server keeps
// listing it as live; the restore path consults this set to keep a dismissed
// tab dismissed across a spawn-triggered re-fetch, a re-mount, or a reload
// (CODIN-1436). An id is spent once the server reports the run ended.
// Versioned key (client-localstorage-schema); reads require a bucket -> array
// of strings map and there is no legacy spelling to migrate.
const DISMISSED_RUNS_KEY = "muxed:dismissed-agent-runs:v1";
// Both axes would otherwise grow forever — one entry per bucket ever dismissed
// in, and one id per dismissal inside it. Keep the most recently dismissed-in
// buckets, and the most recent ids within each.
const MAX_DISMISSED_BUCKETS = 100;
const MAX_DISMISSED_RUNS_PER_BUCKET = 50;

type DismissedRuns = Record<string, string[]>;

function readDismissedRuns(): DismissedRuns {
  try {
    const raw = readVersionedItem(DISMISSED_RUNS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: DismissedRuns = {};
    for (const [bucket, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue;
      map[bucket] = ids.filter((id): id is string => typeof id === "string");
    }
    return map;
  } catch {
    return {};
  }
}

function writeDismissedRuns(map: DismissedRuns): void {
  try {
    localStorage.setItem(DISMISSED_RUNS_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — a dismissal simply won't survive reload */
  }
}

function addDismissedRun(bucket: string, id: string | null): void {
  if (!id) return;
  const map = readDismissedRuns();
  const ids = (map[bucket] ?? []).filter((existing) => existing !== id);
  // Re-insert the bucket last so key order stays most-recently-touched.
  delete map[bucket];
  map[bucket] = [...ids, id].slice(-MAX_DISMISSED_RUNS_PER_BUCKET);
  const buckets = Object.keys(map);
  for (const stale of buckets.slice(0, buckets.length - MAX_DISMISSED_BUCKETS)) {
    delete map[stale];
  }
  writeDismissedRuns(map);
}

function removeDismissedRun(bucket: string, id: string | null): void {
  if (!id) return;
  const map = readDismissedRuns();
  const ids = map[bucket];
  if (!ids?.includes(id)) return;
  const next = ids.filter((existing) => existing !== id);
  if (next.length) map[bucket] = next;
  else delete map[bucket];
  writeDismissedRuns(map);
}

export function dismissedRunsFor(bucket: string): Set<string> {
  return new Set(readDismissedRuns()[bucket] ?? []);
}

export interface SessionMeta {
  sessionId: SessionId;
  taskId: TaskId | null;
  projectId: string;
  moduleId: string;
  // Null only for a shell session: a plain login shell has no provider, and no
  // reader may substitute one for it (#667).
  agent: "claude" | "agy" | "codex" | "gemini" | null;
  status: SessionStatus;
  transport?: TerminalTransport;
  isPlanning: boolean;
  isInstant: boolean;
  // The viewer of a shell run: hosted by the terminal panel, never an agent
  // terminal tab, and never counted as agent activity.
  isShell?: boolean;
  initialPrompt: string | null;
  // Set when this tab reattaches to a persisted tmux session rather than
  // spawning a fresh agent. Drives the attach-mode init frame in ws.ts.
  agentRunId: string | null;
}

export interface OpenSessionArgs {
  taskId: TaskId | null;
  projectId: string;
  moduleId?: string;
  agent: SessionMeta["agent"];
  initialPrompt?: string | null;
  isPlanning?: boolean;
  isInstant?: boolean;
  agentRunId?: string | null;
  select?: boolean;
}

export interface OpenShellSessionArgs {
  moduleId: string;
  projectId: string;
  /** The shell run the backend already launched; a shell never spawns here. */
  agentRunId: string;
}

// A session's *bucket* is its real taskId when set, else a per-module scratch
// bucket. Scratch (no-task plan/instant) work is keyed by its module — NOT one
// shared sentinel — so two modules' scratch terminals, documents, and active
// pointers never bleed into each other (CODIN-984/986).
export function scratchBucketId(moduleId: string): string {
  return `${TEMP_TASK_ID}:${moduleId}`;
}

export function isScratchBucket(bucket: string | null): boolean {
  return !!bucket && bucket.startsWith(TEMP_TASK_ID);
}

export function bucketFor(taskId: TaskId | null, moduleId?: string | null): string {
  return taskId ?? scratchBucketId(moduleId ?? "");
}

export function bucketOfMeta(
  meta: Pick<SessionMeta, "taskId" | "moduleId">,
): string {
  return bucketFor(meta.taskId, meta.moduleId);
}

// Live running-agent count for the synthetic scratch bucket (#496). The count
// is derived purely from local sessions (including reattached scratch tabs) —
// never from task-bound persisted-session hydration.
export function selectScratchAgentCount(
  state: TerminalStoreState,
  moduleId?: string,
  projectId?: string,
): number {
  let count = 0;

  // Count only active no-task (scratch) sessions.
  for (const meta of Object.values(state.sessions)) {
    if (meta.taskId !== null) continue;
    // A shell is not an agent. It shares the taskless shape of a scratch run,
    // so without this it would silently inflate a module's agent count (#667).
    if (meta.isShell) continue;
    if (moduleId && meta.moduleId !== moduleId) continue;
    if (projectId && meta.projectId !== projectId) continue;
    if (
      meta.status === "connecting" ||
      meta.status === "ready" ||
      meta.status === "reconnecting"
    ) {
      count += 1;
    }
  }

  return count;
}

interface TerminalStoreState {
  sessions: Record<SessionId, SessionMeta>;
  sessionByRun: Record<string, SessionId>;
  // Terminal selection lives in the client store; this store owns sessions and transport
  // only, and notifies that store on open/rekey/focus/close.

  openSession: (args: OpenSessionArgs) => SessionId;
  /**
   * Opens the viewer for an already-launched shell run (#667).
   *
   * Deliberately not `openSession`: a shell has no provider to spawn and no
   * workspace tab to open, so this neither creates a run nor tells the
   * workspace tab store anything. The panel owns where a shell is presented.
   */
  openShellSession: (args: OpenShellSessionArgs) => SessionId;
  setReady: (
    tempId: SessionId,
    sessionId: SessionId,
    agentRunId?: string | null,
  ) => void;
  bindRun: (sessionId: SessionId, agentRunId: string) => void;
  setTransport: (sessionId: SessionId, transport: TerminalTransport) => void;
  setExited: (sessionId: SessionId) => void;
  setViewerClosed: (sessionId: SessionId) => void;
  setPtyEof: (sessionId: SessionId) => void;
  setError: (sessionId: SessionId) => void;
  setSessionLost: (sessionId: SessionId) => void;
  setReconnecting: (sessionId: SessionId) => void;
  setReconnected: (sessionId: SessionId) => void;
  lostConnection: (sessionId: SessionId) => void;
  // `dismiss` defaults to true: closing a tab is the user dismissing this
  // browser's view of a run that stays alive server-side, so the restore path
  // must not bring it back. Internal closes that are *not* a dismissal (a
  // re-attach replacing its own dead tab, a run the server says has exited)
  // pass false.
  closeTab: (sessionId: SessionId, opts?: { dismiss?: boolean }) => void;
  focusSession: (sessionId: SessionId) => void;
  reconcileRunTabs: (
    taskId: TaskId,
    runs: readonly RunRecord[],
  ) => void;
  attachRun: (agentRunId: string) => SessionId;
  // `dismiss` defaults to true for the same reason `closeTab` does: an agent
  // run's kill can race a listing that still reports it live. Callers whose run
  // never appears in that listing — a module shell, which `list_scratch_terminals`
  // excludes (#686) — pass false, because a dismissal recorded there can never
  // be spent and would evict real dismissals from the capped ledger.
  terminatePersisted: (
    agentRunId: string,
    taskId: TaskId,
    opts?: { dismiss?: boolean },
  ) => Promise<void>;
}

let _tempCounter = 0;

function makeTempId(): string {
  _tempCounter += 1;
  return `tmp_${Date.now().toString(36)}_${_tempCounter}`;
}

export const useTerminalStore = createApolloStore<TerminalStoreState>("terminal-sessions", (set, get) => ({
  sessions: {},
  sessionByRun: {},

  openSession(args) {
    const tempId = makeTempId();
    const meta: SessionMeta = {
      sessionId: tempId,
      taskId: args.taskId,
      projectId: args.projectId,
      moduleId: args.moduleId ?? "",
      agent: args.agent,
      status: "connecting",
      transport: "connecting",
      isPlanning: args.isPlanning ?? false,
      isInstant: args.isInstant ?? false,
      initialPrompt: args.initialPrompt ?? null,
      agentRunId: args.agentRunId ?? null,
    };
    set((s) => ({ sessions: { ...s.sessions, [tempId]: meta } }));
    useWorkspaceTabsStore
      .getState()
      .tabOpened(bucketOfMeta(meta), tempId, args.select);
    if (args.agentRunId) get().bindRun(tempId, args.agentRunId);
    return tempId;
  },

  openShellSession({ moduleId, projectId, agentRunId }) {
    const existing = get().sessionByRun[agentRunId];
    if (existing && get().sessions[existing]) return existing;
    const tempId = makeTempId();
    const meta: SessionMeta = {
      sessionId: tempId,
      taskId: null,
      projectId,
      moduleId,
      agent: null,
      status: "connecting",
      transport: "connecting",
      isPlanning: false,
      isInstant: false,
      isShell: true,
      initialPrompt: null,
      agentRunId,
    };
    set((s) => ({
      sessions: { ...s.sessions, [tempId]: meta },
      sessionByRun: { ...s.sessionByRun, [agentRunId]: tempId },
    }));
    return tempId;
  },

  setReady(tempId, sessionId, agentRunId) {
    // Capture the pre-rekey identity so the foreground claim (if any) can be
    // migrated to the durable key below, surviving the tmp -> serverId/runId
    // transition without a studio-flicker window (CODIN-749 §5).
    const before = get().sessions[tempId];
    set((s) => {
      const existing = s.sessions[tempId];
      if (!existing) return s;
      // A spawn learns its agent_run_id only on ready; an attach already
      // carries it. Keep the existing value when the frame omits one.
      const updated: SessionMeta = {
        ...existing,
        sessionId,
        status: "ready",
        transport: "ready",
        agentRunId: agentRunId ?? existing.agentRunId,
      };
      const sessions = { ...s.sessions };
      delete sessions[tempId];
      sessions[sessionId] = updated;

      // A tab that reached ready with a durable id is auto-reattach eligible.
      if (updated.agentRunId) addLiveRun(updated.agentRunId);

      const sessionByRun = { ...s.sessionByRun };
      if (existing.agentRunId && existing.agentRunId !== updated.agentRunId) {
        delete sessionByRun[existing.agentRunId];
      }
      if (updated.agentRunId) sessionByRun[updated.agentRunId] = sessionId;
      return { sessions, sessionByRun };
    });
    // Rekey tempId -> serverId in the terminal selection index.
    useWorkspaceTabsStore.getState().tabRekeyed(tempId, sessionId);
    rekeyTerminalFocus(tempId, sessionId);
    if (before) {
      const oldKey = foregroundKey(before);
      const newKey = (agentRunId ?? before.agentRunId) ?? sessionId;
      useTerminalForegroundStore.getState().rekey(oldKey, newKey);
    }
  },

  bindRun(sessionId, agentRunId) {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;
      const sessionByRun = { ...state.sessionByRun };
      if (existing.agentRunId && sessionByRun[existing.agentRunId] === sessionId) {
        delete sessionByRun[existing.agentRunId];
      }
      sessionByRun[agentRunId] = sessionId;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, agentRunId },
        },
        sessionByRun,
      };
    });
  },

  setTransport(sessionId, transport) {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, transport },
        },
      };
    });
  },

  setExited(sessionId) {
    // A closed/exited session must relinquish any foreground claim, returning
    // eligibility to the fallback host without touching the backend run (CODIN-749).
    const closing = get().sessions[sessionId];
    if (closing) {
      useTerminalForegroundStore.getState().release(foregroundKey(closing));
    }
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      // Clean exit (PTY ended / user close): no longer auto-reattach eligible.
      removeLiveRun(existing.agentRunId);
      // Lifecycle truth lives in the agent-status store; only transport-level
      // state changes here.
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...existing,
            status: "exited",
          },
        },
      };
    });
    // Fire-and-forget task list refresh.
  },

  setViewerClosed(sessionId) {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      // The short-lived attach client exited. tmux and the backend run remain
      // authoritative, so preserve both the durable id and backend state.
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, status: "viewer_closed", transport: "closed" },
        },
      };
    });
  },

  setPtyEof(sessionId) {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      // EOF ends the viewer byte stream, not the durable tmux session.
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, status: "pty_eof", transport: "closed" },
        },
      };
    });
  },

  setError(sessionId) {
    // An error session releases any foreground claim (CODIN-749).
    const failing = get().sessions[sessionId];
    if (failing) {
      useTerminalForegroundStore.getState().release(foregroundKey(failing));
    }
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      // Rejected attach (4409 elsewhere / session_not_found) or spawn failure:
      // drop the stale id so a reload does not loop on it.
      removeLiveRun(existing.agentRunId);
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, status: "error" },
        },
      };
    });
  },

  setSessionLost(sessionId) {
    // Mirrors setError, but the attach target is gone for good: the backend
    // answered a mount-attach with `session_not_found` (tmux killed / server
    // restarted). Release any foreground claim and drop the stale live-set id so
    // a reload never loops on it; the terminal `session_lost` status tells the UI
    // to offer no retry (CODIN-799/800).
    const lost = get().sessions[sessionId];
    if (lost) {
      useTerminalForegroundStore.getState().release(foregroundKey(lost));
    }
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      removeLiveRun(existing.agentRunId);
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...existing,
            status: "session_lost",
          },
        },
      };
    });
  },

  setReconnecting(sessionId) {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, status: "reconnecting", transport: "reconnecting" },
        },
      };
    });
  },

  setReconnected(sessionId) {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, status: "ready", transport: "ready" },
        },
      };
    });
  },

  lostConnection(sessionId) {
    // Reconnect budget exhausted: mark exited but KEEP the id, so a later
    // reload can retry the still-possibly-alive tmux session.
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      // The tmux session may still be running; we just can't observe it.
      // Lifecycle lives in the run-state map now, so only transport changes.
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, status: "exited", transport: "closed" },
        },
      };
    });
  },

  closeTab(sessionId, opts) {
    const { sessions } = get();
    const target = sessions[sessionId];
    if (!target) return;
    // Explicit close drops the tab from the auto-reattach set and relinquishes
    // any foreground claim (CODIN-749) without killing the backend run. Because
    // the run stays alive, the id is also remembered as dismissed so a later
    // re-fetch of the server's still-live list cannot resurrect the tab.
    removeLiveRun(target.agentRunId);
    if (opts?.dismiss !== false) {
      addDismissedRun(bucketOfMeta(target), target.agentRunId);
    }
    useTerminalForegroundStore.getState().release(foregroundKey(target));
    const nextSessions = { ...sessions };
    delete nextSessions[sessionId];
    const nextSessionByRun = { ...get().sessionByRun };
    if (target.agentRunId && nextSessionByRun[target.agentRunId] === sessionId) {
      delete nextSessionByRun[target.agentRunId];
    }
    set({ sessions: nextSessions, sessionByRun: nextSessionByRun });
  },

  focusSession(sessionId) {
    const meta = get().sessions[sessionId];
    if (!meta) return;
    useWorkspaceTabsStore.getState().tabFocused(bucketOfMeta(meta), sessionId);
  },

  reconcileRunTabs(taskId, runs) {
    const { sessions, sessionByRun } = get();
    // Ids already held by a live (or reconnecting) tab must not be duplicated.
    const attached = new Set(
      Object.values(sessions)
        .filter(
          (m) =>
            m.status === "connecting" ||
            m.status === "ready" ||
            m.status === "reconnecting",
        )
        .map((m) => m.agentRunId),
    );
    // A spawn initiated from this bucket exists before its durable run id is
    // known. Defer unknown server rows until that connecting tab binds its id;
    // otherwise a projection update can attach the same run into a second tab.
    const hasUnboundSpawn = Object.values(sessions).some(
      (meta) =>
        bucketOfMeta(meta) === taskId &&
        meta.status === "connecting" &&
        meta.agentRunId === null,
    );
    // ProjectRunStatus is the source of truth for which runs need terminal
    // tabs, not the localStorage live-set. A live run must get a tab even if
    // this browser never recorded it: a relaunched run, a reload that raced
    // the `ready` write, or a different browser entirely. The live-set is only
    // a hint for which tabs this browser had open; it must never gate showing
    // a live run.
    //
    // Exactly one exception (CODIN-1436): an id the user explicitly dismissed
    // in this browser stays dismissed. A dismissal is a deliberate per-id
    // instruction recorded at close time, not a stale cache, which is why it
    // may override the projection; the reasoning above still governs every id *not*
    // dismissed, so this must not be widened into gating on the live-set.
    const dismissed = dismissedRunsFor(taskId);
    for (const run of runs) {
      // ProjectRunStatus decides whether a new tab may be restored. An already
      // mounted dead tab stays mounted until a terminal outcome event settles
      // it, because a later authoritative snapshot may repair false liveness.
      if (run.state === "exited" || run.state === "lost" || run.state === "error") {
        removeLiveRun(run.agent_run_id);
        removeDismissedRun(taskId, run.agent_run_id);
        continue;
      }
      // A run with no provider is not an agent run. It has its own surface and
      // must never be restored as an agent terminal tab (#665).
      if (!isTerminalProvider(run.agent)) continue;
      if (attached.has(run.agent_run_id)) continue;
      if (dismissed.has(run.agent_run_id)) continue;
      if (hasUnboundSpawn && !sessionByRun[run.agent_run_id]) continue;
      get().attachRun(run.agent_run_id);
    }
  },

  attachRun(agentRunId) {
    const run = readAgentStatusHolding().runs[agentRunId];
    if (!run) {
      throw new Error(`run projection missing for terminal ${agentRunId}`);
    }
    if (!isTerminalProvider(run.agent)) {
      // Refused rather than papered over with a substitute provider: an agent
      // terminal tab is labelled, spawned and resumed by its provider, so a run
      // that has none cannot be represented as one (#665).
      throw new Error(`run ${agentRunId} has no agent to attach`);
    }
    const { sessions } = get();
    const existingId = get().sessionByRun[agentRunId];
    const existing = existingId ? sessions[existingId] : undefined;
    if (existing) {
      // A live (connecting/ready) tab already views this tmux session;
      // re-attaching would spawn a duplicate viewer, so just focus it.
      if (existing.status === "connecting" || existing.status === "ready") {
        get().focusSession(existing.sessionId);
        return existing.sessionId;
      }
      // The prior tab is dead (exited/error). Drop it so the fresh attach
      // below reconnects to the still-live tmux session. Not a dismissal — this
      // close exists to *re-open* the run, so recording it would suppress the
      // very tab the next line opens.
      get().closeTab(existing.sessionId, { dismiss: false });
    }
    // Scratch rows carry the backend sentinel task id; fold them back into the
    // local scratch bucket (taskId null) and restore their plan/instant label.
    const isScratch = run.scope !== "task";
    return get().openSession({
      taskId: isScratch ? null : run.task_id,
      projectId: run.project_id ?? "",
      moduleId: run.module_id,
      agent: run.agent,
      agentRunId,
      isPlanning: run.scope === "plan",
      isInstant: run.scope === "instant",
      select: false,
    });
  },

  async terminatePersisted(agentRunId, _taskId, opts) {
    await api.terminateTerminal(agentRunId);
    // The session is gone for good: drop it from the auto-reattach set.
    removeLiveRun(agentRunId);
    // Close any live tab attached to the now-killed session so it does not
    // linger with a dead socket. This close counts as a dismissal by default on
    // purpose: a status frame whose response raced the kill still reports the
    // run live, and the tab must not come back. `reconcileRunTabs` spends the
    // dismissal as soon as the server reports the run ended.
    //
    // `dismiss: false` is for runs no restore listing ever reports: with no
    // re-fetch to guard against, the dismissal would sit unspendable in a capped
    // ledger and eventually evict a real one (#686).
    const liveId = get().sessionByRun[agentRunId];
    const live = liveId
      ? get().sessions[liveId]
      : Object.values(get().sessions).find((session) => session.agentRunId === agentRunId);
    if (live) get().closeTab(live.sessionId, { dismiss: opts?.dismiss !== false });
  },
}));
