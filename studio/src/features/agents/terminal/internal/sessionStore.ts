import { create } from "zustand";
import { isCancelledError } from "@tanstack/react-query";
import * as api from "../../api/agentApi";
import {
  getPersistedTerminalSessionIndex,
  getResumableTerminalSessionIndex,
  loadPersistedTerminalSessions,
  loadResumableTerminalSessions,
  loadScratchTerminalSessions,
  setPersistedTerminalSessionIndex,
  setResumableTerminalSessionIndex,
} from "../queries";
import {
  TEMP_TASK_ID,
  type PersistedTerminalSession,
  type ResumableTerminalSession,
  type SessionId,
  type TaskId,
} from "../../types";
import {
  foregroundKey,
  useTerminalForegroundStore,
} from "./foregroundStore";
import { useWorkspaceTabsStore } from "./workspaceTabsStore";
import { readVersionedItem } from "../../../../shared/storage/versioned";
import { useAgentStatusStore } from "../../status";
import { rekeyTerminalFocus } from "./terminalRegistry";

export type PersistedSessionsFetchOutcome =
  | "applied"
  | "superseded"
  | "failed";

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
// Persisted to localStorage so a reload can silently re-attach exactly those
// sessions (and only those) once their task's persisted list is fetched.
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
  agent: "claude" | "agy" | "codex" | "gemini";
  ticketSeq: number | null;
  status: SessionStatus;
  transport?: TerminalTransport;
  isPlanning: boolean;
  isInstant: boolean;
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
  ticketSeq: number | null;
  initialPrompt?: string | null;
  isPlanning?: boolean;
  isInstant?: boolean;
  agentRunId?: string | null;
  select?: boolean;
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

export function scratchResumableKey(projectId: string, moduleId: string): string {
  return `${TEMP_TASK_ID}:${projectId}:${moduleId}`;
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
  persistedSessions: Record<TaskId, PersistedTerminalSession[]>;
  resumableSessions: Record<TaskId, ResumableTerminalSession[]>;

  openSession: (args: OpenSessionArgs) => SessionId;
  setReady: (
    tempId: SessionId,
    sessionId: SessionId,
    agentRunId?: string | null,
  ) => void;
  bindRun: (sessionId: SessionId, agentRunId: string) => void;
  setTransport: (sessionId: SessionId, transport: TerminalTransport) => void;
  setPersisted: (taskId: TaskId, sessions: PersistedTerminalSession[]) => void;
  setResumable: (taskId: TaskId, sessions: ResumableTerminalSession[]) => void;
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
  fetchPersistedSessions: (
    taskId: TaskId,
    signal?: AbortSignal,
  ) => Promise<PersistedSessionsFetchOutcome>;
  refreshResumable: (
    taskId?: TaskId,
    projectId?: string,
    moduleId?: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  fetchScratchSessions: (
    projectId: string,
    moduleId?: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  restoreLiveSessions: (taskId: TaskId) => void;
  attachPersisted: (session: PersistedTerminalSession) => SessionId;
  terminatePersisted: (agentRunId: string, taskId: TaskId) => Promise<void>;
  resumePersisted: (agentRunId: string, taskId: TaskId, projectId?: string, moduleId?: string) => Promise<string>;
}

let _tempCounter = 0;
let _persistedFetchGeneration = 0;
let _resumableFetchGeneration = 0;
// Each map is keyed by task id for a real ticket, and by project/module for
// scratch, so a slower in-flight response can never overwrite a newer one.
const latestPersistedFetch = new Map<string, number>();
const latestResumableFetch = new Map<string, number>();

function scratchFetchKey(projectId: string, moduleId?: string): string {
  return `scratch::${projectId}::${moduleId ?? "*"}`;
}

function makeTempId(): string {
  _tempCounter += 1;
  return `tmp_${Date.now().toString(36)}_${_tempCounter}`;
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  sessions: {},
  sessionByRun: {},
  persistedSessions: {},
  resumableSessions: {},

  openSession(args) {
    const tempId = makeTempId();
    const meta: SessionMeta = {
      sessionId: tempId,
      taskId: args.taskId,
      projectId: args.projectId,
      moduleId: args.moduleId ?? "",
      agent: args.agent,
      ticketSeq: args.ticketSeq,
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

  setPersisted(taskId, sessions) {
    set((state) => ({
      persistedSessions: { ...state.persistedSessions, [taskId]: sessions },
    }));
  },

  setResumable(taskId, sessions) {
    set((state) => ({
      resumableSessions: { ...state.resumableSessions, [taskId]: sessions },
    }));
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

  async fetchPersistedSessions(taskId, signal) {
    const generation = ++_persistedFetchGeneration;
    latestPersistedFetch.set(taskId, generation);
    try {
      // The resumable list is independent of the persisted list; start it
      // first so the two requests overlap (refreshResumable handles its own
      // errors, so partial success is preserved).
      const resumable = signal
        ? get().refreshResumable(taskId, undefined, undefined, signal)
        : get().refreshResumable(taskId);
      const list = await loadPersistedTerminalSessions(taskId);
      if (signal?.aborted) return "superseded";
      if (latestPersistedFetch.get(taskId) !== generation) return "superseded";
      get().setPersisted(taskId, list);
      // Silently re-attach any of this task's previously-live tabs.
      get().restoreLiveSessions(taskId);
      await resumable;
      return "applied";
    } catch (err) {
      if (isCancelledError(err)) return "superseded";
      // Non-fatal: leave any previously-fetched list intact and log.
      console.warn("[terminalStore] fetchPersistedSessions failed", err);
      return "failed";
    } finally {
      if (latestPersistedFetch.get(taskId) === generation) {
        latestPersistedFetch.delete(taskId);
      }
    }
  },

  async refreshResumable(taskId, projectId, moduleId, signal) {
    // A real task always owns the result even when its caller also carries
    // project/module context. Only a genuinely taskless request is scratch.
    const key = taskId ?? (
      projectId && moduleId ? scratchResumableKey(projectId, moduleId) : undefined
    );
    const generation = key ? ++_resumableFetchGeneration : undefined;
    if (key && generation) latestResumableFetch.set(key, generation);
    try {
      const list = await loadResumableTerminalSessions(
        taskId,
        projectId,
        moduleId,
      );
      if (signal?.aborted) return;
      if (key && latestResumableFetch.get(key) !== generation) return;
      if (key) {
        get().setResumable(key, list);
      }
    } catch (err) {
      if (isCancelledError(err)) return;
      console.warn("[terminalStore] refreshResumable failed", err);
    } finally {
      if (key && latestResumableFetch.get(key) === generation) {
        latestResumableFetch.delete(key);
      }
    }
  },

  async fetchScratchSessions(projectId, moduleId, signal) {
    const fetchKey = scratchFetchKey(projectId, moduleId);
    const generation = ++_persistedFetchGeneration;
    latestPersistedFetch.set(fetchKey, generation);
    try {
      // Independent of the scratch list below — start it first so the two
      // requests overlap; it swallows its own errors.
      const resumable = signal
        ? get().refreshResumable(undefined, projectId, moduleId, signal)
        : get().refreshResumable(undefined, projectId, moduleId);
      const list = await loadScratchTerminalSessions(projectId, moduleId);
      if (signal?.aborted) return;
      if (latestPersistedFetch.get(fetchKey) !== generation) return;
      // Scratch rows are bucketed per module (CODIN-986): a project-wide
      // hydration and a module-scoped fetch write disjoint keys instead of
      // clobbering one shared list.
      const byModule = new Map<string, PersistedTerminalSession[]>();
      if (moduleId) byModule.set(scratchBucketId(moduleId), []);
      for (const row of list) {
        const run = useAgentStatusStore.getState().runs[row.agent_run_id];
        if (!run || run.projectId !== projectId || run.taskId !== null) continue;
        const key = scratchBucketId(run.moduleId);
        byModule.set(key, [...(byModule.get(key) ?? []), row]);
      }
      for (const [key, rows] of byModule) {
        get().setPersisted(key, rows);
        // Silently re-attach live scratch sessions. Backlog omits moduleId to
        // hydrate every module badge in one project-scoped request.
        get().restoreLiveSessions(key);
      }
      await resumable;
    } catch (err) {
      if (isCancelledError(err)) return;
      // Non-fatal: leave any previously-fetched list intact and log.
      console.warn("[terminalStore] fetchScratchSessions failed", err);
    } finally {
      if (latestPersistedFetch.get(fetchKey) === generation) {
        latestPersistedFetch.delete(fetchKey);
      }
    }
  },

  restoreLiveSessions(taskId) {
    const { sessions, sessionByRun, persistedSessions } = get();
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
    // otherwise a reconcile fetch can attach the same run into a second tab.
    const hasUnboundSpawn = Object.values(sessions).some(
      (meta) =>
        bucketOfMeta(meta) === taskId &&
        meta.status === "connecting" &&
        meta.agentRunId === null,
    );
    // The server's persisted list is the source of truth for which sessions
    // are live and reattachable — not the localStorage live-set. A session
    // confirmed live server-side must get a tab even if this browser never
    // recorded it: a relaunched run, a reload that raced the `ready` write, or
    // a different browser entirely. The live-set is only a hint for which tabs
    // *this* browser had open; it must never gate showing a live session.
    //
    // Exactly one exception (CODIN-1436): an id the user explicitly dismissed
    // in this browser stays dismissed. A dismissal is a deliberate per-id
    // instruction recorded at close time, not a stale cache, which is why it
    // may override the list; the reasoning above still governs every id *not*
    // dismissed, so this must not be widened into gating on the live-set.
    const dismissed = dismissedRunsFor(taskId);
    for (const session of persistedSessions[taskId] ?? []) {
      const run = useAgentStatusStore.getState().runs[session.agent_run_id];
      if (!run) continue;
      // Liveness is read only from the pushed run projection. The immutable
      // terminal row can therefore never disagree with a lifecycle frame.
      if (run.state === "exited" || run.state === "lost" || run.state === "error") {
        removeLiveRun(session.agent_run_id);
        removeDismissedRun(taskId, session.agent_run_id);
        continue;
      }
      if (attached.has(session.agent_run_id)) continue;
      if (dismissed.has(session.agent_run_id)) continue;
      if (hasUnboundSpawn && !sessionByRun[session.agent_run_id]) continue;
      get().attachPersisted(session);
    }
  },

  attachPersisted(session) {
    const run = useAgentStatusStore.getState().runs[session.agent_run_id];
    if (!run) {
      throw new Error(`run projection missing for terminal ${session.agent_run_id}`);
    }
    const { sessions } = get();
    const existingId = get().sessionByRun[session.agent_run_id];
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
      taskId: isScratch ? null : run.taskId,
      projectId: run.projectId ?? "",
      moduleId: run.moduleId,
      agent: (run.agent ?? "codex") as SessionMeta["agent"],
      ticketSeq: null,
      agentRunId: session.agent_run_id,
      isPlanning: run.scope === "plan",
      isInstant: run.scope === "instant",
      select: false,
    });
  },

  async terminatePersisted(agentRunId, taskId) {
    await api.terminateTerminal(agentRunId);
    // The session is gone for good: drop it from the auto-reattach set.
    removeLiveRun(agentRunId);
    // Close any live tab attached to the now-killed session so it does not
    // linger with a dead socket. This close counts as a dismissal on purpose: a
    // re-fetch whose response raced the kill still reports the run live, and the
    // tab must not come back. `restoreLiveSessions` spends the dismissal as soon
    // as the server reports the run ended.
    const liveId = get().sessionByRun[agentRunId];
    const live = liveId
      ? get().sessions[liveId]
      : Object.values(get().sessions).find((session) => session.agentRunId === agentRunId);
    if (live) get().closeTab(live.sessionId);
    // Drop the row locally so the list reflects the kill without a refetch.
    set((s) => {
      const list = s.persistedSessions[taskId];
      if (!list) return s;
      return {
        persistedSessions: {
          ...s.persistedSessions,
          [taskId]: list.filter((x) => x.agent_run_id !== agentRunId),
        },
      };
    });
    // A scratch bucket is a local key, not a backend task id — refresh its
    // project/module resumables using the session metadata captured above.
    const scratch = isScratchBucket(taskId);
    await get().refreshResumable(
      scratch ? undefined : taskId,
      scratch ? live?.projectId : undefined,
      scratch ? live?.moduleId : undefined,
    );
  },

  async resumePersisted(agentRunId, taskId, projectId, moduleId) {
    const result = await api.resumeTerminal(agentRunId);
    if (isScratchBucket(taskId) && projectId && moduleId) {
      await get().fetchScratchSessions(projectId, moduleId);
    } else {
      await get().fetchPersistedSessions(taskId);
    }
    return result.agent_run_id;
  },
}));

function attachQueryBackedServerSessionIndexes(state: TerminalStoreState): void {
  const persisted = Object.getOwnPropertyDescriptor(state, "persistedSessions");
  if (persisted && "value" in persisted) {
    setPersistedTerminalSessionIndex(persisted.value);
  }
  const resumable = Object.getOwnPropertyDescriptor(state, "resumableSessions");
  if (resumable && "value" in resumable) {
    setResumableTerminalSessionIndex(resumable.value);
  }
  Object.defineProperties(state, {
    persistedSessions: {
      configurable: true,
      enumerable: true,
      get: getPersistedTerminalSessionIndex,
    },
    resumableSessions: {
      configurable: true,
      enumerable: true,
      get: getResumableTerminalSessionIndex,
    },
  });
}

attachQueryBackedServerSessionIndexes(useTerminalStore.getState());
useTerminalStore.subscribe(attachQueryBackedServerSessionIndexes);

const rawSetTerminalState = useTerminalStore.setState;
useTerminalStore.setState = ((partial, replace) => {
  const current = useTerminalStore.getState();
  const next = typeof partial === "function" ? partial(current) : partial;
  const { persistedSessions, resumableSessions, ...clientState } = next;
  if (persistedSessions !== undefined) {
    setPersistedTerminalSessionIndex(persistedSessions);
  }
  if (resumableSessions !== undefined) {
    setResumableTerminalSessionIndex(resumableSessions);
  }
  rawSetTerminalState(clientState, replace);
  attachQueryBackedServerSessionIndexes(useTerminalStore.getState());
}) as typeof useTerminalStore.setState;
