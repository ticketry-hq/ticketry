import { type BlockerChip } from "./internal/issueStore";
import { IconAlertTriangle, IconX } from "../../../shared/ui/icons";
import { quietChipRemoveClassName } from "../fields/QuietChipControls";
import { useTasksStore } from "../../studio/stores/tasksStore";

export default function BlockerChipView({
  chip,
  onRemove,
  disabled = false,
}: {
  chip: BlockerChip;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const selectTask = useTasksStore((state) => state.selectTask);
  const warn = chip.unresolved;
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
        {chip.key ?? chip.id.slice(0, 8)}
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
