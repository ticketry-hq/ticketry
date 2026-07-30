import type {
  AgentLifecycle,
  AgentStatusData,
  AutomationAttemptRecord,
  RawLifecycleState,
} from "./types";

const ATTENTION = new Set<RawLifecycleState>([
  "needs_input", "turn_complete", "error", "lost",
]);
const TERMINAL = new Set<RawLifecycleState>(["exited", "lost"]);
const ACTIVE = new Set<RawLifecycleState>([
  "starting", "working", "permission_required", "reconnecting",
]);
const RANK: Record<AgentLifecycle, number> = { idle: 0, active: 1, attention: 2 };
const LIFECYCLE_STATE_ORDER: RawLifecycleState[] = [
  "lost",
  "error",
  "needs_input",
  "permission_required",
  "turn_complete",
  "working",
  "starting",
  "reconnecting",
  "quiet",
];

export interface TaskLifecycleChip {
  state: RawLifecycleState;
  count: number;
}

export function selectTaskAutomationAttempts(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[] = [],
): AutomationAttemptRecord[] {
  const rootIds = new Set(
    [taskId, ...descendantTaskIds].flatMap(
      (id) => state.automationByTask[id] ?? [],
    ),
  );
  return [...rootIds]
    .map((rootId) => state.automationAttempts[rootId])
    .filter((attempt): attempt is AutomationAttemptRecord => Boolean(attempt))
    .filter((attempt) => attempt.status !== "succeeded")
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at));
}

export function toAgentLifecycle(
  state: RawLifecycleState | null | undefined,
): AgentLifecycle {
  if (state && ATTENTION.has(state)) return "attention";
  if (state && ACTIVE.has(state)) return "active";
  return "idle";
}

export function selectRunState(
  state: AgentStatusData,
  runId: string,
): RawLifecycleState | null {
  return state.runs[runId]?.state ?? null;
}

export function isLiveAgentRunState(
  state: RawLifecycleState | null | undefined,
): boolean {
  return state !== null && state !== undefined && !TERMINAL.has(state);
}

function taskRunIds(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[],
): string[] {
  return [taskId, ...descendantTaskIds].flatMap((id) => state.byTask[id] ?? []);
}

export function selectTaskAgentLifecycle(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[] = [],
): AgentLifecycle {
  let best: AgentLifecycle = "idle";
  for (const runId of taskRunIds(state, taskId, descendantTaskIds)) {
    const lifecycle = toAgentLifecycle(state.runs[runId]?.state);
    if (RANK[lifecycle] > RANK[best]) best = lifecycle;
  }
  return best;
}

export function selectTaskRunCount(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[] = [],
): number {
  return taskRunIds(state, taskId, descendantTaskIds).filter(
    (runId) => isLiveAgentRunState(state.runs[runId]?.state),
  ).length;
}

export function selectTaskLifecycleChips(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[] = [],
): TaskLifecycleChip[] {
  const counts = new Map<RawLifecycleState, number>();
  for (const runId of taskRunIds(state, taskId, descendantTaskIds)) {
    const lifecycle = state.runs[runId]?.state;
    if (!lifecycle || !LIFECYCLE_STATE_ORDER.includes(lifecycle)) continue;
    counts.set(lifecycle, (counts.get(lifecycle) ?? 0) + 1);
  }
  return LIFECYCLE_STATE_ORDER.flatMap((lifecycle) => {
    const count = counts.get(lifecycle);
    return count ? [{ state: lifecycle, count }] : [];
  });
}

export function selectScratchLifecycleChips(
  state: AgentStatusData,
  projectId: string,
  moduleId: string,
): TaskLifecycleChip[] {
  if (state.projectId !== projectId) return [];

  const counts = new Map<RawLifecycleState, number>();
  for (const run of Object.values(state.runs)) {
    if (run.moduleId !== moduleId) continue;
    if (run.scope !== "plan" && run.scope !== "instant") continue;
    if (!isLiveAgentRunState(run.state)) continue;
    if (!LIFECYCLE_STATE_ORDER.includes(run.state)) continue;
    counts.set(run.state, (counts.get(run.state) ?? 0) + 1);
  }
  return LIFECYCLE_STATE_ORDER.flatMap((lifecycle) => {
    const count = counts.get(lifecycle);
    return count ? [{ state: lifecycle, count }] : [];
  });
}

/**
 * Run ids of the plan/instant runs that belong to one module's scratch bucket
 * that must remain mounted as terminal tabs. Unlike
 * `selectScratchLifecycleChips`, this deliberately retains terminal-state runs
 * so an exited or lost run does not unmount its terminal. A scratch bucket is
 * keyed by module, not by task id, so membership is module + scope rather than
 * `byTask`.
 */
export function selectScratchRunIds(
  state: AgentStatusData,
  projectId: string,
  moduleId: string,
): string[] {
  if (state.projectId !== projectId) return [];
  const ids: string[] = [];
  for (const run of Object.values(state.runs)) {
    if (run.moduleId !== moduleId) continue;
    if (run.scope !== "plan" && run.scope !== "instant") continue;
    ids.push(run.runId);
  }
  return ids;
}

export const MODULE_LIFECYCLE_STATES = [
  "error",
  "needs_input",
  "permission_required",
  "working",
] as const;
export type ModuleLifecycleState = (typeof MODULE_LIFECYCLE_STATES)[number];
export type ModuleLifecycleCounts = Record<ModuleLifecycleState, number>;

function isModuleLifecycleState(
  state: RawLifecycleState,
): state is ModuleLifecycleState {
  return MODULE_LIFECYCLE_STATES.includes(state as ModuleLifecycleState);
}

export function selectModuleLifecycleCounts(
  state: AgentStatusData,
  moduleId: string,
): ModuleLifecycleCounts {
  const counts: ModuleLifecycleCounts = {
    error: 0,
    needs_input: 0,
    permission_required: 0,
    working: 0,
  };
  for (const run of Object.values(state.runs)) {
    if (run.moduleId !== moduleId || !isModuleLifecycleState(run.state)) continue;
    counts[run.state] += 1;
  }
  return counts;
}
