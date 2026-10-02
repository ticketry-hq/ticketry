import { getStatesSnapshot, stateById } from "../../../../../features/projects";
import type { ScopedWorkflowSettings, State, WorkItem } from "../../../../../shared/api/types";
import { compareStateOrder, stateColor, stateLabel } from "../../../../../shared/utilities/display";
import Popover, { PopoverOption } from "../../../../../shared/ui/Popover";
import PopoverContent from "../../../../../shared/ui/PopoverContent";
import PickerTrigger from "./fields/PickerTrigger";

type TrackState = State & { id: string };

interface WorkflowStatePickerProps {
  task: WorkItem;
  states: readonly State[];
  workflow: ScopedWorkflowSettings | undefined;
  permittedStateIds: ReadonlySet<string>;
  saving: boolean;
  onStateChange: (state: TrackState) => void;
}

/** The item's workflow states in order, excluding off-track cancellation. */
export function workflowTrack(
  states: readonly State[],
  workflow: ScopedWorkflowSettings | undefined,
): TrackState[] {
  const ids = new Set<string>();
  if (workflow?.start_state_id) ids.add(workflow.start_state_id);
  for (const transition of workflow?.transitions ?? []) {
    ids.add(transition.from_state_id);
    ids.add(transition.to_state_id);
  }
  return states
    .filter((state): state is TrackState =>
      state.id !== null && ids.has(state.id) && state.group !== "cancelled")
    .sort(compareStateOrder);
}

function Dot({ color }: { color: string }) {
  return <span className="h-2.5 w-2.5 flex-none" style={{ backgroundColor: color }} />;
}

/**
 * State dropdown that shows the whole workflow in order: the current state is
 * marked, permitted destinations are choosable, and the rest are shown for
 * context only. Off-track destinations (Cancelled) follow a divider.
 */
export function WorkflowStatePicker({
  task,
  states,
  workflow,
  permittedStateIds,
  saving,
  onStateChange,
}: WorkflowStatePickerProps) {
  const selected = stateById([...states], task.state);
  const track = workflowTrack(states, workflow);
  const trackIds = new Set(track.map((state) => state.id));
  const offTrack = states
    .filter((state): state is TrackState =>
      state.id !== null && permittedStateIds.has(state.id) && !trackIds.has(state.id))
    .sort(compareStateOrder);
  const choose = (state: TrackState, close: () => void) => {
    // The catalog may have changed while the menu was open.
    if (getStatesSnapshot(task.project_id).some((candidate) => candidate.id === state.id)) {
      onStateChange(state);
    }
    close();
  };

  return (
    <Popover
      data-testid="state-picker"
      trigger={({ onClick, disabled }) => (
        <PickerTrigger
          onClick={onClick}
          disabled={disabled}
          label={<>{stateLabel(selected)}<span aria-hidden className="text-xs text-text-muted">▾</span></>}
          icon={<Dot color={stateColor(selected)} />}
          saving={saving}
        />
      )}
    >
      {(close) => (
        <PopoverContent>
          {track.length === 0 && offTrack.length === 0 && (
            <div className="px-3 py-2 text-sm text-text-muted">No permitted transitions</div>
          )}
          {track.map((state) => {
            if (state.id === task.state) {
              return (
                <div
                  key={state.id}
                  aria-current="step"
                  className="flex items-center gap-2 bg-pane-title px-3 py-1.5 text-base text-focus-accent"
                >
                  <Dot color={stateColor(state)} />
                  {state.name}
                  <span className="ml-auto pl-4 text-xs text-text-muted">current</span>
                </div>
              );
            }
            if (permittedStateIds.has(state.id)) {
              return (
                <PopoverOption key={state.id} onClick={() => choose(state, close)}>
                  <Dot color={stateColor(state)} />
                  {state.name}
                </PopoverOption>
              );
            }
            return (
              <div
                key={state.id}
                title={`${state.name} is not reachable from ${stateLabel(selected)}`}
                className="flex items-center gap-2 px-3 py-1.5 text-base text-text-muted opacity-60"
              >
                <Dot color={stateColor(state)} />
                {state.name}
              </div>
            );
          })}
          {offTrack.length > 0 && (
            <div className="mt-1 border-t border-pane-border pt-1">
              {offTrack.map((state) => (
                <PopoverOption key={state.id} onClick={() => choose(state, close)}>
                  <Dot color={stateColor(state)} />
                  {state.name}
                </PopoverOption>
              ))}
            </div>
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}
