import { projectRunPresentation } from "./runPresentation";
import { isAgentlessRun } from "./runScopes";
import type {
  AgentLifecycle,
  AgentStatusData,
  AutomationAttemptRecord,
  RunPresentationState,
  RunRecord,
} from "./types";

const ATTENTION = new Set<RunPresentationState>([
  "needs_input", "turn_complete", "error", "lost",
]);
const TERMINAL = new Set<RunPresentationState>(["exited", "lost"]);
const ACTIVE = new Set<RunPresentationState>([
  "starting", "working", "permission_required", "reconnecting",
]);
const RANK: Record<AgentLifecycle, number> = { idle: 0, active: 1, attention: 2 };
const LIFECYCLE_STATE_ORDER: RunPresentationState[] = [
  "lost",
  "error",
  "needs_input",
  "permission_required",
  "turn_complete",
  "working",
  "starting",
  "reconnecting",
  "stalled",
  "quiet",
];

export interface TaskLifecycleChip {
  state: RunPresentationState;
  count: number;
}

/**
 * Every selector below reads a run through this one projection, so a terminal
 * tab, the work-item aggregate, and a module count cannot disagree about the
 * same run.
 */
function presentationOf(run: RunRecord | undefined): RunPresentationState | null {
  return run ? projectRunPresentation(run) : null;
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
  state: RunPresentationState | null | undefined,
): AgentLifecycle {
  if (state && ATTENTION.has(state)) return "attention";
  if (state && ACTIVE.has(state)) return "active";
  return "idle";
}

/** The effective presentation of one run: provider lifecycle, overlaid. */
export function selectRunState(
  state: AgentStatusData,
  runId: string,
): RunPresentationState | null {
  return presentationOf(state.runs[runId]);
}

export function isLiveAgentRunState(
  state: RunPresentationState | null | undefined,
): boolean {
  return state !== null && state !== undefined && !TERMINAL.has(state);
}

function taskRunIds(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[],
): string[] {
  const taskIds = new Set([taskId, ...descendantTaskIds]);
  return Object.values(state.runs)
    // Work-item rollups and subtree chicklets are agent activity. A shell run
    // hangs off its module's own work item, so a task filter alone already
    // misses it — but the exclusion is stated rather than inherited (#670).
    .filter((run) => !isAgentlessRun(run))
    .filter((run) => run.task_id !== null && taskIds.has(run.task_id))
    .map((run) => run.agent_run_id);
}

export function selectTaskAgentLifecycle(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[] = [],
): AgentLifecycle {
  let best: AgentLifecycle = "idle";
  for (const runId of taskRunIds(state, taskId, descendantTaskIds)) {
    const lifecycle = toAgentLifecycle(presentationOf(state.runs[runId]));
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
    (runId) => isLiveAgentRunState(presentationOf(state.runs[runId])),
  ).length;
}

export function selectTaskLifecycleChips(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[] = [],
): TaskLifecycleChip[] {
  const counts = new Map<RunPresentationState, number>();
  for (const runId of taskRunIds(state, taskId, descendantTaskIds)) {
    const lifecycle = presentationOf(state.runs[runId]);
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

  const counts = new Map<RunPresentationState, number>();
  for (const run of Object.values(state.runs)) {
    if (run.module_id !== moduleId) continue;
    if (run.scope !== "plan" && run.scope !== "instant") continue;
    const presented = projectRunPresentation(run);
    if (!isLiveAgentRunState(presented)) continue;
    if (!LIFECYCLE_STATE_ORDER.includes(presented)) continue;
    counts.set(presented, (counts.get(presented) ?? 0) + 1);
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
    if (run.module_id !== moduleId) continue;
    if (run.scope !== "plan" && run.scope !== "instant") continue;
    ids.push(run.agent_run_id);
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
  state: RunPresentationState,
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
    // A module badge counts agent activity. A shell run is the person's own
    // terminal and never moves it — declared here rather than left to fall out
    // of which lifecycle states a run without agent hooks happens to reach,
    // because that is exactly how the exclusion would regress silently (#670).
    if (isAgentlessRun(run)) continue;
    const presented = projectRunPresentation(run);
    if (run.module_id !== moduleId || !isModuleLifecycleState(presented)) continue;
    counts[presented] += 1;
  }
  return counts;
}
