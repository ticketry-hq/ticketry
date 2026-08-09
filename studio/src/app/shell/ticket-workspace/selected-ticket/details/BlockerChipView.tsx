import {
  type BlockerChip,
  formatWorkItemDisplayIdentifier,
} from "../../../../../features/work-items";
import { IconAlertTriangle, IconX } from "../../../../../shared/ui/icons";
import { quietChipRemoveClassName } from "./fields/QuietChipControls";
import { useClientStore } from "../../../../../state/clientStore";

export default function BlockerChipView({
  chip,
  onRemove,
  disabled = false,
}: {
  chip: BlockerChip;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const selectTask = useClientStore((state) => state.selectTask);
  const warn = chip.unresolved;
  // An unresolved reference keeps its existing neutral id stub rather than
  // inventing a ticket identifier.
  const identifier =
    formatWorkItemDisplayIdentifier(chip.sequence_id) || chip.id.slice(0, 8);
  return (
    <span
      data-testid="blocker-chip"
      data-warn={warn ? "true" : "false"}
      className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        warn
          ? "border-lifecycle-attention/60 bg-lifecycle-attention/10 text-lifecycle-attention"
          : "border-pane-border bg-pane-title text-text-primary"
      }`}
      title={warn ? "This blocker is still open" : undefined}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => void selectTask(chip.id)}
        className="inline-flex items-center gap-1 font-mono hover:underline"
      >
        {identifier}
        {warn && <IconAlertTriangle size={12} />}
      </button>
      {onRemove && (
        <button
          type="button"
          disabled={disabled}
          aria-label="Remove blocker"
          data-testid="remove-blocker"
          onClick={onRemove}
          className={quietChipRemoveClassName}
        >
          <IconX size={12} />
        </button>
      )}
    </span>
  );
}
