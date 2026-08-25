import type { ActionStep, ActionStepName } from "../types";
import { stepLabel } from "./actionPresentation";

/**
 * The stacked action's steps, always shown in the order they run.
 *
 * The same list serves three jobs — a plan before a run, progress during one,
 * and each step's reported outcome afterwards — because they are the same
 * information at different times. A step the backend has not reported yet is
 * `running` while the action is in flight and `pending` before it starts;
 * everything else comes from the step the backend sent.
 */
export function ActionStepList({
  order,
  reported,
  running,
}: {
  order: readonly ActionStepName[];
  reported: ReadonlyMap<ActionStepName, ActionStep>;
  running: boolean;
}) {
  return (
    <ol data-testid="action-steps" className="mt-2 flex flex-col gap-0.5">
      {order.map((name) => (
        <StepRow
          key={name}
          name={name}
          step={reported.get(name)}
          running={running}
        />
      ))}
    </ol>
  );
}

function StepRow({
  name,
  step,
  running,
}: {
  name: ActionStepName;
  step: ActionStep | undefined;
  running: boolean;
}) {
  const state = step ? step.status : running ? "running" : "pending";
  return (
    <li
      data-testid={`action-step-${name}`}
      data-state={state}
      className="flex items-baseline gap-2 text-xs"
    >
      <span className="w-40 shrink-0 text-text-secondary">
        {stepLabel(name)}
      </span>
      <span className={`shrink-0 ${STATE_TONES[state]}`}>
        {STATE_LABELS[state]}
      </span>
      {step && (
        <span className="min-w-0 flex-1 truncate text-text-muted">
          {step.detail}
        </span>
      )}
    </li>
  );
}

const STATE_LABELS: Record<string, string> = {
  pending: "Not started",
  running: "Running…",
  ok: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

const STATE_TONES: Record<string, string> = {
  pending: "text-text-muted",
  running: "text-text-muted",
  ok: "text-lifecycle-success",
  skipped: "text-lifecycle-attention",
  failed: "text-lifecycle-danger",
};
