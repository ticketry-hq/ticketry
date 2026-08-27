import {
  getStatesSnapshot,
  stateById,
  useCachedStates,
} from "../../../../../../features/projects";
import { compareStateOrder, stateColor, stateLabel } from "../../../../../../shared/utilities/display";
import type { State } from "../../../../../../shared/api/types";
import Popover, { PopoverOption } from "./Popover";
import PickerTrigger from "./PickerTrigger";

interface Props {
  projectId: string;
  value: string | null;
  onChange: (state: State & { id: string }) => void;
  saving?: boolean;
  /** Neutral trigger text for the bulk bar ("Set state…") — overrides the label. */
  triggerLabel?: string;
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 flex-none"
      style={{ backgroundColor: color }}
    />
  );
}

// Status picker grouped by the five workflow groups.
export default function StatePicker({ projectId, value, onChange, saving, triggerLabel }: Props) {
  const states = useCachedStates(projectId);
  const selected = stateById(states, value);
  // Ordered by canonical workflow position (sort_order primary), so Refinement
  // precedes Ready and Implement precedes Review within their shared groups.
  const ordered = [...states].sort(compareStateOrder);

  return (
    <Popover
      data-testid="state-picker"
      trigger={({ onClick, disabled }) => (
        <PickerTrigger
          onClick={onClick}
          disabled={disabled}
          label={triggerLabel ?? stateLabel(selected)}
          icon={<Dot color={stateColor(selected)} />}
          saving={saving}
        />
      )}
    >
      {(close) =>
        ordered.length === 0 ? (
          <div className="px-3 py-2 text-sm text-text-muted">No states</div>
        ) : (
          ordered.map((s) => (
            <PopoverOption
              key={s.id ?? s.name}
              selected={s.id === value}
              onClick={() => {
                if (
                  s.id &&
                  getStatesSnapshot(projectId).some(
                    (state) => state.id === s.id,
                  )
                ) {
                  onChange(s as State & { id: string });
                }
                close();
              }}
            >
              <Dot color={stateColor(s)} />
              {s.name}
            </PopoverOption>
          ))
        )
      }
    </Popover>
  );
}
