interface SubtreeRunButtonProps {
  /** Distinct accessible name for this campaign mode. */
  name: string;
  pending: boolean;
  pendingLabel: string;
  onClick: () => void;
  disabled?: boolean;
  unavailableReason?: string;
}

/** One subtree-run control, sharing the details surface's action styling. */
export function SubtreeRunButton({
  name,
  pending,
  pendingLabel,
  onClick,
  disabled = false,
  unavailableReason,
}: SubtreeRunButtonProps) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-busy={pending}
      title={unavailableReason ?? name}
      disabled={pending || disabled}
      onClick={onClick}
      className="border border-pane-border px-2 py-1 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? pendingLabel : name}
    </button>
  );
}
