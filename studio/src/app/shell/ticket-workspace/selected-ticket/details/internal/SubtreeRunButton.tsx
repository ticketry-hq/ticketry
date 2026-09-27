import { KeyBadge } from "../../../../../../shared/ui/KeyChordHint";

interface SubtreeRunButtonProps {
  /** Distinct accessible name for this campaign mode. */
  name: string;
  pending: boolean;
  pendingLabel: string;
  onClick: () => void;
  disabled?: boolean;
  unavailableReason?: string;
  /** Chord label when this button owns the normal-run shortcut. */
  shortcut?: string | null;
}

/** One subtree-run control, sharing the details surface's action styling. */
export function SubtreeRunButton({
  name,
  pending,
  pendingLabel,
  onClick,
  disabled = false,
  unavailableReason,
  shortcut,
}: SubtreeRunButtonProps) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-busy={pending}
      title={unavailableReason ?? name}
      disabled={pending || disabled}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-2 border border-pane-border px-2.5 text-sm text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? pendingLabel : name}
      {shortcut && !pending ? <KeyBadge>{shortcut}</KeyBadge> : null}
    </button>
  );
}
