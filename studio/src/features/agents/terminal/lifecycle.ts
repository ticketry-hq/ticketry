// Agent lifecycle / attention model (ticket #498).
//
// This is the SECOND status axis for a terminal session, independent of the
// websocket transport status (`SessionStatus` in terminalStore). Transport
// answers "is the pipe healthy?"; lifecycle answers "what is the agent doing?".
// Per-agent adapters (#499–502) and the inactivity fallback (#503) feed this
// axis by emitting normalized `LifecycleEvent`s; the UI (#504) renders it.
//
// Mirrors core/core/models.py (LifecycleState / LifecycleEventKind / LifecycleEvent).

// Normalized attention state. Defaults to `unknown` until a real event arrives,
// so an unwired agent or a missed event degrades gracefully rather than lying.
export type LifecycleState =
  | "starting"
  | "working"
  | "needs_input"
  | "permission_required"
  | "turn_complete"
  | "quiet"
  | "reconnecting"
  | "exited"
  | "lost"
  | "error"
  | "unknown";

// The render-facing vocabulary (#661). `stalled` is the effective presentation
// of a still-live run whose terminal output has not changed for 60 seconds. It
// is never emitted by an adapter, never reduced from an event kind, and never
// persisted as a run's lifecycle state — the projection in
// features/agents/status/runPresentation.ts is its only source.
export type TerminalPresentationState = LifecycleState | "stalled";

// What an adapter reports happened. The reducer maps a kind to a state, so the
// wire vocabulary (kinds) stays decoupled from the rendered vocabulary (states).
export type LifecycleEventKind =
  | "session_start"
  | "turn_start"
  | "tool_use"
  | "awaiting_input"
  | "permission_required"
  | "turn_complete"
  | "idle"
  | "error"
  | "session_end";

// Provenance of an event. Hook scripts default to `hook`; the inactivity
// fallback (#503) will emit `inactivity`; transport-derived events use `transport`.
export type LifecycleEventSource = "hook" | "inactivity" | "transport";

// The normalized envelope every adapter emits, keyed to a durable session id.
export interface LifecycleEvent {
  agent_run_id: string;
  agent: "claude" | "agy" | "codex" | "gemini";
  kind: LifecycleEventKind;
  ts: string;
  message?: string | null;
  source?: LifecycleEventSource;
}

// Single source of truth for kind → state. An absent entry means "unrecognized".
const KIND_TO_STATE: Record<LifecycleEventKind, LifecycleState> = {
  session_start: "starting",
  turn_start: "working",
  tool_use: "working",
  awaiting_input: "needs_input",
  permission_required: "permission_required",
  turn_complete: "turn_complete",
  idle: "quiet",
  error: "error",
  session_end: "exited",
};

// Pure lifecycle transition. Maps a recognized event kind onto the next state;
// an unknown/missing kind is ignored so a malformed event never corrupts state.
//
// Kept free of any store or I/O so the transition logic is unit-testable on its
// own — the unit the ticket's acceptance criteria call out.
export function reduceLifecycle(
  current: LifecycleState,
  kind: LifecycleEventKind,
): LifecycleState {
  return KIND_TO_STATE[kind] ?? current;
}

// ---------------------------------------------------------------------------
// Presentation (ticket #504).
//
// The render-facing view of a lifecycle state. Kept here (next to the state
// model, free of any React/Tailwind dependency) so labels, priority, and the
// attention flag stay a single source of truth shared by tab badges and the
// task-tree attention chip, and so priority ordering is unit-testable on its
// own — an acceptance criterion of the ticket.
// ---------------------------------------------------------------------------

// Semantic color band, mapped to concrete classes by the LifecycleBadge.
export type LifecycleTone =
  | "active"
  | "attention"
  | "danger"
  | "idle"
  | "muted"
  | "neutral"
  | "success";

export interface LifecyclePresentation {
  // Compact human label; empty string means "render nothing".
  label: string;
  // Single-glyph marker shown before the label.
  glyph: string;
  tone: LifecycleTone;
  // Higher wins when summarizing several sessions into one indicator.
  priority: number;
  // Whether this state should bubble up to the task tree as needing the user.
  needsAttention: boolean;
  // Accessible explanation; states honest about heuristic origins.
  title: string;
}

// Single source of truth for how each state renders. `unknown` is intentionally
// blank so an unwired/degraded session shows no badge rather than a guess.
const PRESENTATION: Record<TerminalPresentationState, LifecyclePresentation> = {
  starting: {
    label: "Starting",
    glyph: "○",
    tone: "active",
    priority: 2,
    needsAttention: false,
    title: "Agent session is starting up",
  },
  working: {
    label: "Working",
    glyph: "▶",
    tone: "active",
    priority: 2,
    needsAttention: false,
    title: "Agent is actively working",
  },
  needs_input: {
    label: "Needs input",
    glyph: "?",
    tone: "attention",
    priority: 4,
    needsAttention: true,
    title: "Agent is waiting for your input",
  },
  permission_required: {
    label: "Permission required",
    glyph: "◇",
    tone: "attention",
    priority: 2,
    needsAttention: false,
    title: "A permission decision is pending",
  },
  turn_complete: {
    label: "Done",
    glyph: "✓",
    tone: "success",
    priority: 3,
    needsAttention: true,
    title: "Agent finished its turn and is awaiting you",
  },
  quiet: {
    label: "Quiet",
    glyph: "·",
    tone: "idle",
    priority: 1,
    needsAttention: false,
    // Honest about the heuristic: inactivity is not a confirmed completion.
    title: "No recent activity (heuristic — not a confirmed completion)",
  },
  stalled: {
    label: "Stalled",
    glyph: "◴",
    tone: "idle",
    priority: 1,
    needsAttention: false,
    // Honest about what was actually observed: quiet output, not a dead,
    // failed, or completed process.
    title: "Terminal output has not changed for 60 seconds (the session is still live)",
  },
  reconnecting: {
    label: "Reconnecting",
    glyph: "⟳",
    tone: "neutral",
    priority: 2,
    needsAttention: false,
    title: "Reconnecting to the terminal session",
  },
  exited: {
    label: "Exited",
    glyph: "✕",
    tone: "muted",
    priority: 0,
    needsAttention: false,
    title: "Agent session has exited",
  },
  lost: {
    label: "Session lost",
    glyph: "!",
    tone: "danger",
    priority: 5,
    needsAttention: true,
    title: "The backend terminal session could not be found",
  },
  error: {
    label: "Error",
    glyph: "!",
    tone: "danger",
    priority: 5,
    needsAttention: true,
    title: "Agent session reported an error",
  },
  unknown: {
    label: "",
    glyph: "",
    tone: "neutral",
    priority: 0,
    needsAttention: false,
    title: "",
  },
};

// Look up the render-facing view of a state.
export function presentLifecycle(
  state: TerminalPresentationState,
): LifecyclePresentation {
  return PRESENTATION[state];
}

// Reduce many session states to the single most attention-worthy one, or null
// when none needs the user. Drives the task-tree summary, where one row can
// stand for several live sessions.
export function highestAttentionState(
  states: LifecycleState[],
): LifecycleState | null {
  let best: LifecycleState | null = null;
  let bestPriority = -Infinity;

  for (const state of states) {
    const p = PRESENTATION[state];
    if (!p.needsAttention) continue;
    if (p.priority > bestPriority) {
      bestPriority = p.priority;
      best = state;
    }
  }

  return best;
}
