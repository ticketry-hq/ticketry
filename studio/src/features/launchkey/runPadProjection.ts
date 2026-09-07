import {
  PALETTE,
  type LaunchkeyMiniMK3,
  type PadEffect,
} from "@bandwati/launchkey-adaptor";

import {
  projectRunPresentation,
  type AgentRunScope,
  type AgentStatusData,
  type RunPresentationState,
  type RunRecord,
} from "../agents/status";

const PAD_COUNT = 16;

interface ProjectedLight {
  readonly color: number;
  readonly effect: PadEffect;
}

interface PadCandidate {
  readonly runId: string;
  readonly state: RunPresentationState;
  readonly taskId: string | null;
  readonly startedAt: string;
}

type PadOutput = Pick<LaunchkeyMiniMK3["output"]["pads"], "set">;

const ELIGIBLE_SCOPES: ReadonlySet<AgentRunScope> = new Set([
  "task",
  "plan",
  "docchat",
]);

const OFF: ProjectedLight = { color: PALETTE.off, effect: "steady" };
// Launchkey velocity 1 is the dark grey the palette does not name.
const DIM: ProjectedLight = { color: 1, effect: "steady" };
const LIGHTS: Record<RunPresentationState, ProjectedLight> = {
  working: { color: PALETTE.white, effect: "steady" },
  needs_input: { color: PALETTE.yellow, effect: "pulse" },
  permission_required: { color: PALETTE.white, effect: "flash" },
  turn_complete: { color: PALETTE.green, effect: "steady" },
  quiet: { color: PALETTE.blue, effect: "steady" },
  stalled: { color: PALETTE.yellow, effect: "steady" },
  starting: { color: PALETTE.white, effect: "pulse" },
  reconnecting: { color: PALETTE.white, effect: "pulse" },
  error: { color: PALETTE.red, effect: "steady" },
  lost: { color: PALETTE.red, effect: "steady" },
  exited: OFF,
  // Unknown is still a live run, so present it as transitional rather than
  // making an occupied pad look empty.
  unknown: { color: PALETTE.white, effect: "pulse" },
};

function toCandidate(run: RunRecord): PadCandidate {
  return {
    runId: run.agent_run_id,
    state: projectRunPresentation(run),
    taskId: run.task_id,
    startedAt: run.started_at ?? run.updated_at,
  };
}

/**
 * Pads follow the Stories tree: taskless conversations first, then runs in
 * tree order of their work item, then runs whose work item is not in the
 * open module. Ties fall back to start order.
 */
function byTreeOrder(taskOrder: readonly string[]) {
  const rank = new Map(taskOrder.map((id, index) => [id, index]));
  const rankOf = (candidate: PadCandidate) =>
    candidate.taskId === null ? -1 : rank.get(candidate.taskId) ?? Infinity;
  return (left: PadCandidate, right: PadCandidate): number =>
    rankOf(left) - rankOf(right) ||
    left.startedAt.localeCompare(right.startedAt) ||
    left.runId.localeCompare(right.runId);
}

function sameLight(
  left: ProjectedLight | undefined,
  right: ProjectedLight,
): boolean {
  return left?.color === right.color && left.effect === right.effect;
}

function isFailure(state: RunPresentationState): boolean {
  return state === "error" || state === "lost";
}

export interface RunPadProjection {
  /**
   * Re-lay pads out for `status`. Every other lit pad dims while
   * `selectedRunId` occupies a pad; `taskOrder` is the Stories tree order.
   */
  update(
    status: AgentStatusData,
    selectedRunId?: string | null,
    taskOrder?: readonly string[],
  ): void;
  /** Return the run on a pressed pad and acknowledge it when it is red. */
  press(pad: number): string | null;
}

export function createRunPadProjection(
  pads: PadOutput,
): RunPadProjection {
  const rendered: Array<ProjectedLight | undefined> = Array(PAD_COUNT);
  let assignments: Array<PadCandidate | undefined> = [];
  const acknowledgedFailures = new Set<string>();
  // Only failures of runs seen live during this connection may occupy pads.
  // A fresh status snapshot also includes historical failures.
  const observedLiveRuns = new Set<string>();
  // Failed runs stay on their pad until pressed, even once the status stream
  // drops them.
  const retainedFailures = new Map<string, PadCandidate>();
  let candidates: PadCandidate[] = [];
  let compare = byTreeOrder([]);
  let selectedRunId: string | null = null;
  let projectId: string | null = null;

  const layout = () => {
    assignments = candidates
      .filter((candidate) =>
        candidate.state !== "exited" &&
        !(acknowledgedFailures.has(candidate.runId) && isFailure(candidate.state)))
      .sort(compare)
      .slice(0, PAD_COUNT);
    const dimOthers = assignments.some((run) => run?.runId === selectedRunId);
    for (let index = 0; index < PAD_COUNT; index += 1) {
      const assignment = assignments[index];
      const next = !assignment
        ? OFF
        : dimOthers && assignment.runId !== selectedRunId
        ? DIM
        : LIGHTS[assignment.state];
      if (sameLight(rendered[index], next)) continue;
      pads.set(index + 1, next);
      rendered[index] = next;
    }
  };

  return {
    update(status, selected = null, taskOrder = []) {
      selectedRunId = selected;
      if (status.projectId !== projectId) {
        observedLiveRuns.clear();
        acknowledgedFailures.clear();
        retainedFailures.clear();
        projectId = status.projectId;
      }
      const live = (status.projectId === null
        ? []
        : Object.values(status.runs)
          .filter((run) => ELIGIBLE_SCOPES.has(run.scope))
          .filter((run) => !run.project_id || run.project_id === status.projectId)
          .map(toCandidate))
        .filter((run) => {
          if (isFailure(run.state)) return observedLiveRuns.has(run.runId);
          if (run.state !== "exited") observedLiveRuns.add(run.runId);
          return true;
        });
      for (const run of live) {
        if (isFailure(run.state)) {
          retainedFailures.set(run.runId, run);
        } else {
          retainedFailures.delete(run.runId);
          acknowledgedFailures.delete(run.runId);
        }
      }
      const liveIds = new Set(live.map((run) => run.runId));
      candidates = [
        ...live,
        ...[...retainedFailures.values()].filter((run) => !liveIds.has(run.runId)),
      ];
      compare = byTreeOrder(taskOrder);
      layout();
    },
    press(pad) {
      if (!Number.isInteger(pad) || pad < 1 || pad > PAD_COUNT) return null;
      const assigned = assignments[pad - 1];
      if (!assigned) return null;
      if (isFailure(assigned.state)) {
        acknowledgedFailures.add(assigned.runId);
        retainedFailures.delete(assigned.runId);
        layout();
      }
      return assigned.runId;
    },
  };
}
