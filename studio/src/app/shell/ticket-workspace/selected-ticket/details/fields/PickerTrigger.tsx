import type { ReactNode } from "react";

interface PickerTriggerProps {
  label: string | ReactNode;
  icon?: ReactNode;
  saving?: boolean;
  disabled?: boolean;
  variant?: "default" | "dashed" | "bare";
  onClick?: () => void;
  "data-testid"?: string;
}

export default function PickerTrigger({
  label,
  icon,
  saving,
  disabled,
  variant = "default",
  onClick,
  "data-testid": testId,
}: PickerTriggerProps) {
  const className = {
    bare: "inline-flex items-center gap-2 px-2.5 py-1 text-sm text-text-primary hover:bg-pane-title disabled:opacity-50",
    dashed:
      "inline-flex items-center gap-1 border border-dashed border-focus-accent px-2.5 py-0.5 text-xs text-focus-accent hover:bg-pane-title disabled:opacity-50",
    default:
      "inline-flex items-center gap-2 border border-pane-border px-2.5 py-1 text-sm text-text-primary hover:border-text-muted disabled:opacity-50",
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-testid={testId}
    >
      {icon}
      {label}
      {saving && <span className="text-xs text-text-muted">…</span>}
    </button>
  );
}
