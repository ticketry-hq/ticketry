import { Fragment } from "react";

import type { ScopedWorkflowImpact, State } from "../../shared/api/types";
import { settingsButtonClass } from "../../shared/ui/SettingsPrimitives";

export interface PendingWorkflowChange {
  title: string;
  confirmLabel: string;
  impact: ScopedWorkflowImpact;
  commit: () => Promise<void>;
}

export function WorkflowImpactDialog({
  change,
  states,
  close,
  confirm,
}: {
  change: PendingWorkflowChange;
  states: State[];
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const stateName = (stateId: string) =>
    states.find((state) => state.id === stateId)?.name ?? stateId;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workflow deletion impact"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg space-y-4 border border-pane-border bg-pane-panel p-5 shadow-xl">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{change.title}</h2>
          <p className="mt-1 text-sm text-text-muted">
            This will delete the following type-specific transitions, launch prompts,
            and subtree-run capability.
          </p>
        </div>
        <ul aria-label="Configuration to delete" className="space-y-1 text-sm text-text-primary">
          {change.impact.deleted_transitions.map((edge) => (
            <li key={`${edge.from_state_id}:${edge.to_state_id}`}>
              Transition: {stateName(edge.from_state_id)} → {stateName(edge.to_state_id)}
            </li>
          ))}
          {change.impact.deleted_launch_bindings.map((binding) => (
            <Fragment key={`binding:${binding.state_id}`}>
              <li>Launch binding: {stateName(binding.state_id)}</li>
              {binding.subtree_run_enabled ? (
                <li>Subtree-run capability: {stateName(binding.state_id)}</li>
              ) : null}
            </Fragment>
          ))}
          {change.impact.disabled_auto_start_state_ids.map((stateId) => (
            <li key={`auto:${stateId}`}>Auto-start: {stateName(stateId)}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={settingsButtonClass("secondary")}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            className={settingsButtonClass("danger-filled")}
          >
            {change.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
