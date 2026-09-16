type Details = Record<string, number | string | boolean>;
type Trace = {
  id: number;
  taskId: string;
  started: number;
  origin: string;
  stages: Set<string>;
};
type PendingModuleInput = { started: number; source: string };
type ClickChain = { taskId: string; traceId: number; phase: "pointer" | "click" };
let sequence = 0;
let current: Trace | undefined;
let pendingModuleInput: PendingModuleInput | undefined;
let clickChain: ClickChain | undefined;
const sessionId = typeof crypto?.randomUUID === "function"
  ? crypto.randomUUID()
  : `${performance.timeOrigin}-${Math.random().toString(36).slice(2)}`;

export function beginTaskDetail(taskId: string | null, source: string): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  if (!taskId) {
    current = undefined;
    pendingModuleInput = undefined;
    clickChain = undefined;
    return;
  }
  const origin = source === "module-restoration" ? pendingModuleInput : undefined;
  pendingModuleInput = undefined;
  clickChain = undefined;
  current = {
    id: ++sequence,
    taskId,
    started: origin?.started ?? performance.now(),
    origin: origin?.source ?? "task-selection",
    stages: new Set(),
  };
  taskDetailPoint(taskId)("task-selection", {
    source,
    ...(origin ? { origin_source: origin.source } : {}),
  });
}

function eventStartedAt(eventTimeStamp: number, handlerStarted: number): number {
  const candidate = eventTimeStamp > 1_000_000_000_000
    ? eventTimeStamp - performance.timeOrigin
    : eventTimeStamp;
  return Number.isFinite(candidate) && candidate >= 0 && candidate <= handlerStarted
    ? candidate
    : handlerStarted;
}

/** Starts the trace at physical row input, before the click dispatches selection. */
export function beginTaskDetailFromClick(taskId: string, eventTimeStamp: number): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  pendingModuleInput = undefined;
  const handlerStarted = performance.now();
  const eventStarted = eventStartedAt(eventTimeStamp, handlerStarted);
  current = {
    id: ++sequence,
    taskId,
    started: eventStarted,
    origin: "task-pointer-input",
    stages: new Set(),
  };
  clickChain = { taskId, traceId: current.id, phase: "pointer" };
  taskDetailPoint(taskId)("task-pointer-input", {
    source: "task-row",
    event_to_handler_ms: Math.round(Math.max(0, handlerStarted - current.started) * 10) / 10,
  });
}

/** Marks the click handler that dispatches selection, retaining pointer input when present. */
export function recordTaskDetailClick(taskId: string, eventTimeStamp: number): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  const handlerStarted = performance.now();
  const retainsPointer = clickChain?.taskId === taskId &&
    clickChain.phase === "pointer" && clickChain.traceId === current?.id;
  if (!retainsPointer) {
    pendingModuleInput = undefined;
    current = {
      id: ++sequence,
      taskId,
      started: eventStartedAt(eventTimeStamp, handlerStarted),
      origin: "task-click",
      stages: new Set(),
    };
  }
  const trace = current;
  if (!trace) return;
  clickChain = { taskId, traceId: trace.id, phase: "click" };
  const clickElapsed = Math.round((handlerStarted - trace.started) * 10) / 10;
  taskDetailPoint(taskId)("task-click", {
    source: "task-row",
    event_to_handler_ms: Math.round((handlerStarted - eventStartedAt(eventTimeStamp, handlerStarted)) * 10) / 10,
    click_elapsed_ms: clickElapsed,
  });
}

/** Captures module selection entry so a restored task includes the module wait. */
export function beginTaskDetailModuleInput(source: string): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  current = undefined;
  clickChain = undefined;
  pendingModuleInput = { started: performance.now(), source };
}

/** Keeps a row-click trace intact when its handler reaches the workspace store. */
export function recordTaskSelection(taskId: string, source: string): void {
  if (clickChain?.taskId === taskId && clickChain.phase === "click" &&
    clickChain.traceId === current?.id) {
    taskDetailPoint(taskId)("task-selection-dispatched", { source });
    clickChain = undefined;
    return;
  }
  beginTaskDetail(taskId, source);
}

/** First occurrence of each milestone, scoped to one selection, with no task text. */
export function taskDetailPoint(taskId: string | null = current?.taskId ?? null) {
  const trace = current;
  return (stage: string, details: Details = {}) => {
    if (!trace || trace.taskId !== taskId || trace.stages.has(stage)) return;
    const elapsed = performance.now() - trace.started;
    if (elapsed > 120_000) return;
    trace.stages.add(stage);
    console.info("[task-detail]", JSON.stringify({
      session_id: sessionId, selection_id: trace.id, task_id: trace.taskId, stage,
      elapsed_ms: Math.round(elapsed * 10) / 10, elapsed_origin: trace.origin, ...details,
    }));
  };
}
