import { Terminal, type IDisposable } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

import { useTerminalStore, type SessionMeta } from "./sessionStore";
import { ackTerminal } from "./actions";
import type { TerminalClient } from "./terminalClient";
import { terminalClientTransport } from "./terminalClientRuntime";
import { createTerminalRun } from "../../api/agentApi";
import { launchFailureMessage, launchFailureReason } from "./launchFailure";

// CODIN-749 — shared terminal entry pool.
//
// The xterm/WebSocket *object lifecycle* extracted out of TerminalHost's former
// component-local `entriesRef`. A module-level singleton so the Terminal/WS
// pair for a session exists exactly once, independent of how many surfaces
// (workspace and drawer hosts) reference it. This is the
// mechanism half of single-owner: the registry decides *which* surface may
// attach a session's DOM; the pool guarantees the object it attaches is never
// duplicated. Scrollback lives in the Terminal's in-memory buffer, so
// re-attaching the same Terminal into a different host div preserves it.

export interface SessionEntry {
  term: Terminal;
  fit: FitAddon;
  ws: TerminalClient | null;
  lastCols: number;
  lastRows: number;
  initialPrompt: string | null;
  isPlanning: boolean;
  isInstant: boolean;
  agentRunId: string | null;
  // How many surfaces currently present this session's xterm DOM (hosts report
  // via notifyForeground/notifyBackground). At 0 for the grace period, the
  // transport is suspended so hidden terminals stop streaming.
  visibleCount: number;
  suspendTimer: ReturnType<typeof setTimeout> | null;
  // A fresh terminal must receive its durable run id from the control plane
  // before a WebSocket is allowed to attach.
  creatingRun: boolean;
  onDataSubscription: IDisposable | null;
}

// How long a session may sit with no surface presenting it before its
// WebSocket is suspended. Long enough to absorb ownership transfers between
// surfaces and quick tab flips; the single knob for the suspend policy.
export const SUSPEND_GRACE_MS = 30_000;

const XTERM_OPTIONS = {
  fontFamily: "JetBrains Mono, Fira Code, ui-monospace, monospace",
  fontSize: 13,
  cursorBlink: true,
  convertEol: false,
  theme: {
    background: "#0a0a0a",
    foreground: "#d6deeb",
    cursor: "#7aa2f7",
    selectionBackground: "#2d3a5a",
  },
};

const DEFAULT_TERMINAL_GEOMETRY = { cols: 80, rows: 24 };
const TERMINAL_GEOMETRY_STORAGE_KEY = "worktracker:terminal-geometry";

function readTerminalGeometry(): { cols: number; rows: number } {
  try {
    const stored = sessionStorage.getItem(TERMINAL_GEOMETRY_STORAGE_KEY);
    if (!stored) return DEFAULT_TERMINAL_GEOMETRY;
    const parsed = JSON.parse(stored) as { cols?: unknown; rows?: unknown };
    if (
      typeof parsed.cols === "number" &&
      Number.isInteger(parsed.cols) &&
      parsed.cols > 0 &&
      parsed.cols <= 1000 &&
      typeof parsed.rows === "number" &&
      Number.isInteger(parsed.rows) &&
      parsed.rows > 0 &&
      parsed.rows <= 1000
    ) {
      return { cols: parsed.cols, rows: parsed.rows };
    }
  } catch {
    /* Storage may be unavailable or contain malformed data. */
  }
  return DEFAULT_TERMINAL_GEOMETRY;
}

export function rememberTerminalGeometry(cols: number, rows: number): void {
  try {
    sessionStorage.setItem(TERMINAL_GEOMETRY_STORAGE_KEY, JSON.stringify({ cols, rows }));
  } catch {
    /* Geometry caching is an optimization; fitting still corrects the size. */
  }
}

const entries = new Map<string, SessionEntry>();

// Create entries for new sessions and dispose entries for sessions that
// vanished from the store. Idempotent — an existing entry is left untouched, so
// this can run on every render without churning the Terminal/WS objects.
export function syncEntries(sessions: Record<string, SessionMeta>): void {
  for (const [id, meta] of Object.entries(sessions)) {
    if (entries.has(id)) continue;
    const initialGeometry = readTerminalGeometry();
    const term = new Terminal({ ...XTERM_OPTIONS, ...initialGeometry });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const entry: SessionEntry = {
      term,
      fit,
      ws: null,
      lastCols: initialGeometry.cols,
      lastRows: initialGeometry.rows,
      initialPrompt: meta.initialPrompt,
      isPlanning: meta.isPlanning,
      isInstant: meta.isInstant,
      agentRunId: meta.agentRunId,
      visibleCount: 0,
      suspendTimer: null,
      creatingRun: false,
      onDataSubscription: null,
    };
    entries.set(id, entry);
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type !== "keydown" ||
        event.key !== "Enter" ||
        !event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing
      ) {
        return true;
      }
      try {
        entry.ws?.input(new Uint8Array([0x1b, 0x0d]));
      } catch {
        /* noop */
      }
      return false;
    });
  }
  for (const id of Array.from(entries.keys())) {
    if (id in sessions) continue;
    // More than one Terminal presenter can reconcile this singleton pool.
    // An effect from an older render must not dispose an entry that a newer
    // store state still owns, especially while durable run creation is in
    // flight: recreating that entry would issue a second creation request.
    if (id in useTerminalStore.getState().sessions) continue;
    const entry = entries.get(id);
    entries.delete(id);
    if (entry) {
      if (entry.suspendTimer) {
        clearTimeout(entry.suspendTimer);
        entry.suspendTimer = null;
      }
      try {
        entry.ws?.detach();
      } catch {
        /* noop */
      }
      entry.onDataSubscription?.dispose();
      entry.onDataSubscription = null;
      entry.term.dispose();
    }
  }
}

export function getEntry(sessionId: string): SessionEntry | undefined {
  return entries.get(sessionId);
}

/** Release xterm's transient viewer before the desktop swaps to libghostty. */
export function releasePooledTransport(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry?.ws) return;
  try {
    entry.ws.detach();
  } catch {
    /* The native attach will report a durable-session failure independently. */
  }
  entry.ws = null;
}

// Open the WebSocket for a session that is `connecting`, or reattach a `ready`
// durable session whose pooled handle disappeared with the last terminal host.
// Idempotent: a second call while a handle exists is a no-op — this is what
// makes a second WS viewer for the same live run impossible.
//
// The caller must have seeded `entry.lastCols/lastRows` from a fit before this
// runs so the PTY is born at the visible geometry.
export function ensureConnected(sessionId: string, meta: SessionMeta): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  const store = useTerminalStore.getState;
  const canAttachReadySession = meta.status === "ready" && entry.agentRunId !== null;
  if (
    entry.ws !== null ||
    (meta.status !== "connecting" && !canAttachReadySession)
  ) {
    return;
  }

  if (entry.agentRunId === null) {
    if (entry.creatingRun) return;
    entry.creatingRun = true;
    void createTerminalRun({
      agent: meta.agent,
      project_id: meta.projectId,
      module_id: meta.moduleId,
      task_id: meta.taskId,
      initial_prompt: entry.isInstant ? null : entry.initialPrompt,
      is_planning: entry.isPlanning,
      is_instant: entry.isInstant,
      instant_prompt: entry.isInstant ? entry.initialPrompt : null,
    })
      .then(({ agent_run_id }) => {
        entry.creatingRun = false;
        // The tab might have been closed while creation was in flight. The
        // durable run remains attachable, but this disposed xterm must not open
        // a transport of its own.
        if (entries.get(sessionId) !== entry) return;
        entry.agentRunId = agent_run_id;
        store().bindRun(sessionId, agent_run_id);
        ensureConnected(sessionId, {
          ...meta,
          agentRunId: agent_run_id,
        });
      })
      .catch((error: unknown) => {
        entry.creatingRun = false;
        entry.term.write(`\r\n[control_plane] ${launchFailureMessage(error)}\r\n`);
        store().setError(sessionId);
      });
    return;
  }

  const tempId = sessionId;
  // Tracks the tab's current store id across the tempId -> serverId rekey;
  // reconnect callbacks fire long after open and need the live id.
  let liveId = tempId;
  const cols = entry.lastCols;
  const rows = entry.lastRows;
  // The last error-frame message the backend sent before a non-clean close.
  // A mount-attach to a dead session sends `{message:"session_not_found"}` then
  // closes 1008; we read it here (no wire change) to distinguish a permanently
  // gone session from a transient transport failure (CODIN-799/800).

  let firstReady = true;
  const handle = terminalClientTransport.attach(
    {
      agentRunId: entry.agentRunId,
      cols,
      rows,
    },
    (event) => {
      if (event.type === "ready") {
        if (firstReady) {
          firstReady = false;
          const serverId = event.sessionId;
          const runId = event.agentRunId;
        // Rekey the entry under the server id so subsequent lookups work. The
        // matching registry rekey (tmp -> agentRunId) happens centrally in
        // terminalStore.setReady, so a claim placed before ready survives.
        const e = entries.get(tempId);
        if (e) {
          e.agentRunId = runId ?? e.agentRunId;
          entries.delete(tempId);
          entries.set(serverId, e);
        }
        liveId = serverId;
        ackTerminal(tempId, serverId, runId);
        // The init geometry is applied while the tmux viewer is still being
        // attached. Re-send it after ready so the server processes a resize
        // through the live viewer pump even when xterm's size did not change.
        try {
          handle.resize(entry.term.cols, entry.term.rows);
        } catch {
          /* The socket may close while the ready frame is being handled. */
        }
        } else {
          entry.term.write("\r\n[reconnected]\r\n");
          store().setReconnected(liveId);
        }
        return;
      }
      if (event.type === "output") {
        entry.term.write(event.bytes);
        return;
      }
      if (event.type === "connecting" && !firstReady && event.attempt > 0) {
        entry.term.write(`\r\n[reconnecting… attempt ${event.attempt}]\r\n`);
        store().setReconnecting(liveId);
        return;
      }
      if (event.type === "error") {
        entry.term.write(`\r\n[${event.layer}] ${launchFailureReason(event.message)}\r\n`);
        return;
      }
      if (
        event.type === "reattachment_required" &&
        (event.reason === "session_not_found" || event.reason === "session_ended")
      ) {
        entry.term.write("\r\n[session lost]\r\n");
        store().setSessionLost(liveId);
        return;
      }
      if (event.type === "reattachment_required") {
        entry.term.write(`\r\n[disconnected]\r\n`);
        store().lostConnection(liveId);
        return;
      }
      if (event.type === "closed" && event.reason !== "client_detach") {
        if (event.reason === "viewer_exit") store().setViewerClosed(liveId);
        else if (event.reason === "pty_eof") store().setPtyEof(liveId);
        else store().setError(liveId);
      }
    },
  );
  const resizeSocket = handle.resize.bind(handle);
  handle.resize = (nextCols: number, nextRows: number) => {
    rememberTerminalGeometry(nextCols, nextRows);
    resizeSocket(nextCols, nextRows);
  };
  entry.ws = handle;

  // Wire term input → ws.
  const encoder = new TextEncoder();
  entry.onDataSubscription?.dispose();
  entry.onDataSubscription = entry.term.onData((data) => {
    try {
      handle.input(encoder.encode(data));
    } catch {
      /* noop */
    }
  });
}

// Visibility policy: hosts report DOM attach/detach per session; when the last
// surface backs off, a grace timer suspends the transport so a hidden terminal
// stops streaming (the backend viewer + xterm parse work are pure waste while
// nobody looks). Refocus resumes via the socket's re-attach path — tmux is the
// durable source, so the screen redraws and copy-mode scrollback is intact.

// Both take the entry object, not a session id: the tempId → serverId rekey in
// ensureConnected's onReady changes the map key mid-flight, and a host pairing
// a foreground under one id with a background under the other would leak a
// count. The entry object is stable across the rekey.

// A host began presenting this entry's xterm DOM.
export function notifyForeground(entry: SessionEntry): void {
  entry.visibleCount += 1;
  if (entry.suspendTimer) {
    clearTimeout(entry.suspendTimer);
    entry.suspendTimer = null;
  }
  if (entry.ws?.status() === "suspended") entry.ws.resume();
}

// A host stopped presenting this entry's xterm DOM. When no surface is left,
// arm the grace timer; suspend() itself refuses non-reattachable sockets, so
// this is safe to fire for connecting/spawn-failed sessions too.
export function notifyBackground(entry: SessionEntry): void {
  entry.visibleCount = Math.max(0, entry.visibleCount - 1);
  if (entry.visibleCount > 0 || entry.suspendTimer) return;
  entry.suspendTimer = setTimeout(() => {
    entry.suspendTimer = null;
    if (entry.visibleCount === 0) entry.ws?.suspend();
  }, SUSPEND_GRACE_MS);
}

// Pool driver ref-count (CODIN-751). Both workspace and drawer hosts
// issue drawer's DrawerTerminalHost drive the pool (syncEntries/ensureConnected)
// and register as drivers while mounted. The drawer lives in the Studio shell,
// so it can be open while another host is unmounted; tearing the pool down when
// one host unmounts would kill the live session another host still shows.
// Entries are disposed only when the LAST driver unregisters.
let driverCount = 0;
let driverGeneration = 0;

// Register the caller as a pool driver; returns an idempotent unregister that
// disposes every entry once the final driver releases. Final disposal waits one
// microtask so React StrictMode's same-cycle effect remount can reclaim the
// existing entries, including an in-flight durable-run creation guard.
export function registerPoolDriver(): () => void {
  driverGeneration += 1;
  driverCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    driverCount = Math.max(0, driverCount - 1);
    if (driverCount !== 0) return;
    const releasedGeneration = driverGeneration;
    queueMicrotask(() => {
      if (driverCount === 0 && driverGeneration === releasedGeneration) {
        disposeAll();
      }
    });
  };
}

// Unmount-time teardown: close every socket and dispose every Terminal.
export function disposeAll(): void {
  for (const entry of entries.values()) {
    if (entry.suspendTimer) {
      clearTimeout(entry.suspendTimer);
      entry.suspendTimer = null;
    }
    try {
      entry.ws?.detach();
    } catch {
      /* noop */
    }
    entry.onDataSubscription?.dispose();
    entry.onDataSubscription = null;
    entry.term.dispose();
  }
  entries.clear();
}

// Test-only: the live entry count, for asserting create-once / dispose.
export function _entryCount(): number {
  return entries.size;
}
