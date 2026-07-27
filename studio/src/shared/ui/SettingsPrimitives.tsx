import type { HTMLAttributes, ReactNode } from "react";

export const SETTINGS_SECTION_HEADING_CLASS =
  "text-base font-semibold text-text-primary";

export const SETTINGS_EYEBROW_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-text-secondary";

export const SETTINGS_FIELD_CLASS =
  "min-w-0 rounded border border-pane-border bg-pane-bg px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent focus:ring-1 focus:ring-focus-accent";

export const SETTINGS_CHECKBOX_CLASS =
  "grid size-4 shrink-0 appearance-none place-content-center rounded-[3px] border border-pane-border bg-pane-bg before:size-2 before:scale-0 before:bg-pane-bg before:content-[''] checked:border-focus-accent checked:bg-focus-accent checked:before:scale-100 disabled:cursor-not-allowed disabled:opacity-40";

type SettingsButtonTier =
  | "primary"
  | "secondary"
  | "danger"
  | "danger-filled";

const BUTTON_TIER_CLASS: Record<SettingsButtonTier, string> = {
  primary:
    "border-focus-accent bg-focus-accent font-semibold text-pane-bg hover:brightness-110",
  secondary:
    "border-pane-border text-text-primary hover:border-text-secondary",
  danger:
    "border-lifecycle-danger text-lifecycle-danger hover:bg-lifecycle-danger/10",
  "danger-filled":
    "border-lifecycle-danger bg-lifecycle-danger font-semibold text-pane-bg hover:brightness-110",
};

export function settingsButtonClass(
  tier: SettingsButtonTier,
  className = "",
): string {
  return `rounded border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_TIER_CLASS[tier]} ${className}`;
}

type SettingsStatusTone = "success" | "attention" | "danger";

const STATUS_TONE_CLASS: Record<SettingsStatusTone, string> = {
  success:
    "border-l-lifecycle-success bg-lifecycle-success/10 text-lifecycle-success",
  attention:
    "border-l-lifecycle-attention bg-lifecycle-attention/10 text-lifecycle-attention",
  danger:
    "border-l-lifecycle-danger bg-lifecycle-danger/10 text-lifecycle-danger",
};

interface SettingsStatusLineProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone: SettingsStatusTone;
}

export function SettingsStatusLine({
  children,
  className = "",
  tone,
  ...props
}: SettingsStatusLineProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded border-l-2 px-3 py-2 text-sm ${STATUS_TONE_CLASS[tone]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

interface SettingsSubsectionProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  children: ReactNode;
  description?: ReactNode;
  headingRole?: "section" | "subsection";
  title: ReactNode;
}

export function SettingsSubsection({
  children,
  className = "",
  description,
  headingRole = "subsection",
  title,
  ...props
}: SettingsSubsectionProps) {
  return (
    <section
      className={`border-t border-pane-border pt-4 first:border-t-0 first:pt-0 ${className}`}
      {...props}
    >
      {headingRole === "section" ? (
        <h2 className={SETTINGS_SECTION_HEADING_CLASS}>{title}</h2>
      ) : (
        <h3 className={SETTINGS_EYEBROW_CLASS}>{title}</h3>
      )}
      {description ? (
        <p className="mb-3 mt-1 text-sm text-text-muted">{description}</p>
      ) : null}
      {children}
    </section>
  );
}
