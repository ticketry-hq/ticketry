import {
  useBacklogStore,
  useWorkItems,
} from "../../../../../../features/work-items";
import { compareStateOrder, stateColor, stateLabel } from "../../../../../../shared/utilities/display";
import type { State } from "../../../../../../shared/api/types";
import Popover, { PopoverOption } from "./Popover";
import PickerTrigger from "./PickerTrigger";

interface Props {
  value: State | null;
  onChange: (stateId: string) => void;
  saving?: boolean;
  /** Neutral trigger text for the bulk bar ("Set state…") — overrides the label. */
  triggerLabel?: string;
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 flex-none rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

// Status picker grouped by the five workflow groups.
export default function StatePicker({ value, onChange, saving, triggerLabel }: Props) {
  const { states } = useWorkItems();
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
          label={triggerLabel ?? stateLabel(value)}
          icon={<Dot color={stateColor(value)} />}
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
              selected={s.id === value?.id}
              onClick={() => {
                if (
                  s.id &&
                  useBacklogStore.getState().states.some(
                    (state) => state.id === s.id,
                  )
                ) {
                  onChange(s.id);
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
