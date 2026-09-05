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

interface PadAssignment {
  readonly runId: string;
  readonly state: RunPresentationState;
}

type PadOutput = Pick<LaunchkeyMiniMK3["output"]["pads"], "set">;

const ELIGIBLE_SCOPES: ReadonlySet<AgentRunScope> = new Set([
  "task",
  "plan",
  "docchat",
]);

const OFF: ProjectedLight = { color: PALETTE.off, effect: "steady" };
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

function byStartOrder(left: RunRecord, right: RunRecord): number {
  const leftStarted = left.started_at ?? left.updated_at;
  const rightStarted = right.started_at ?? right.updated_at;
  return leftStarted.localeCompare(rightStarted) ||
    left.agent_run_id.localeCompare(right.agent_run_id);
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
  update(status: AgentStatusData): void;
  /** Return the run on a pressed pad and acknowledge it when it is red. */
  press(pad: number): string | null;
}

export function createRunPadProjection(
  pads: PadOutput,
): RunPadProjection {
  const rendered: Array<ProjectedLight | undefined> = Array(PAD_COUNT);
  const assignments: Array<PadAssignment | undefined> = Array(PAD_COUNT);
  const acknowledgedFailures = new Set<string>();
  // Only failures of runs seen live during this connection may occupy pads.
  // A fresh status snapshot also includes historical failures.
  const observedLiveRuns = new Set<string>();
  let waiting: PadAssignment[] = [];
  let projectId: string | null = null;

  const render = () => {
    for (let index = 0; index < PAD_COUNT; index += 1) {
      const assignment = assignments[index];
      const next = assignment ? LIGHTS[assignment.state] : OFF;
      if (sameLight(rendered[index], next)) continue;
      pads.set(index + 1, next);
      rendered[index] = next;
    }
  };

  const fillFreePads = (candidates: readonly PadAssignment[]) => {
    const assignedIds = new Set(
      assignments.flatMap((assignment) => assignment?.runId ?? []),
    );
    const available = candidates.filter((candidate) =>
      candidate.state !== "exited" &&
      !(acknowledgedFailures.has(candidate.runId) && isFailure(candidate.state)) &&
      !assignedIds.has(candidate.runId)
    );
    let candidateIndex = 0;
    for (let padIndex = 0; padIndex < PAD_COUNT; padIndex += 1) {
      if (assignments[padIndex]) continue;
      const candidate = available[candidateIndex];
      if (!candidate) break;
      assignments[padIndex] = candidate;
      assignedIds.add(candidate.runId);
      candidateIndex += 1;
    }
    waiting = available.slice(candidateIndex);
  };

  return {
    update(status) {
      if (status.projectId !== projectId) observedLiveRuns.clear();
      const candidates = (status.projectId === null
        ? []
        : Object.values(status.runs)
          .filter((run) => ELIGIBLE_SCOPES.has(run.scope))
          .filter((run) => !run.project_id || run.project_id === status.projectId)
          .sort(byStartOrder))
        .map((run): PadAssignment => ({
          runId: run.agent_run_id,
          state: projectRunPresentation(run),
        }))
        .filter((run) => {
          if (isFailure(run.state)) return observedLiveRuns.has(run.runId);
          if (run.state !== "exited") observedLiveRuns.add(run.runId);
          return true;
        });

      if (status.projectId !== projectId) {
        assignments.fill(undefined);
        acknowledgedFailures.clear();
        projectId = status.projectId;
      } else {
        const current = new Map(candidates.map((candidate) => [candidate.runId, candidate]));
        for (const candidate of candidates) {
          if (acknowledgedFailures.has(candidate.runId) && !isFailure(candidate.state)) {
            acknowledgedFailures.delete(candidate.runId);
          }
        }
        for (let index = 0; index < PAD_COUNT; index += 1) {
          const assigned = assignments[index];
          if (!assigned) continue;
          const next = current.get(assigned.runId);
          if (!next) {
            if (!isFailure(assigned.state)) assignments[index] = undefined;
            continue;
          }
          assignments[index] = next.state === "exited" ||
              acknowledgedFailures.has(next.runId) && isFailure(next.state)
            ? undefined
            : next;
        }
      }

      fillFreePads(candidates);
      render();
    },
    press(pad) {
      if (!Number.isInteger(pad) || pad < 1 || pad > PAD_COUNT) return null;
      const padIndex = pad - 1;
      const assigned = assignments[padIndex];
      if (!assigned) return null;
      if (isFailure(assigned.state)) {
        acknowledgedFailures.add(assigned.runId);
        assignments[padIndex] = waiting.shift();
        render();
      }
      return assigned.runId;
    },
  };
}
