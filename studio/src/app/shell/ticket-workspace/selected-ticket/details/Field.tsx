import React from "react";

interface FieldProps {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  saving?: boolean;
}

export default function Field({
  label,
  children,
  muted = false,
  saving = false,
}: FieldProps) {
  return (
    <div
      data-testid="details-field"
      className={`inline-flex min-w-0 items-center gap-2 ${
        muted ? "text-text-muted" : ""
      }`}
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
        className={`min-w-0 transition-opacity ${
          saving ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
