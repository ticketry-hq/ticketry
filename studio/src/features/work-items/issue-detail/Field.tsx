import React from "react";

type FieldArrangement = "inline" | "stacked";

interface FieldProps {
  label: string;
  children: React.ReactNode;
  arrangement?: FieldArrangement;
  muted?: boolean;
  saving?: boolean;
}

export default function Field({
  label,
  children,
  arrangement = "inline",
  muted = false,
  saving = false,
}: FieldProps) {
  return (
    <div
      data-testid="details-field"
      data-arrangement={arrangement}
      className={`${
        arrangement === "inline"
          ? "flex items-center justify-between gap-3 py-2"
          : "py-2.5"
      } ${muted ? "text-text-muted" : ""}`}
    >
      <span
        data-testid="field-label"
        className={`text-xs uppercase tracking-wider ${
          muted ? "text-text-muted" : "text-text-secondary"
        }`}
      >
        {label}
      </span>
      <div
        data-testid="field-value"
        aria-busy={saving || undefined}
        aria-disabled={saving || undefined}
        className={`${
          arrangement === "inline" ? "min-w-0 text-right" : "mt-1.5 min-w-0 w-full"
        } transition-opacity ${saving ? "pointer-events-none opacity-50" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
