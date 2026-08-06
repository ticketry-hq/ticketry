export const quietChipRemoveClassName =
  "text-text-muted opacity-0 transition-opacity hover:text-lifecycle-danger focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100";

export function GhostChipAdd({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs text-text-muted opacity-60 transition-colors hover:bg-pane-title hover:text-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-accent disabled:opacity-30"
    >
      +
    </button>
  );
}
