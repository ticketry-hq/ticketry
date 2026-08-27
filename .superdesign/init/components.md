# Shared UI primitives

## `studio/src/shared/ui/SettingsPrimitives.tsx`

Ticketry's reusable field, button, status, and section treatments.

```tsx
import type { HTMLAttributes, ReactNode } from "react";

export const SETTINGS_SECTION_HEADING_CLASS =
  "text-base font-semibold text-text-primary";
export const SETTINGS_EYEBROW_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-text-secondary";
export const SETTINGS_FIELD_CLASS =
  "min-w-0 border border-pane-border bg-pane-bg px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent focus:ring-1 focus:ring-focus-accent";

type SettingsButtonTier = "primary" | "secondary" | "danger" | "danger-filled";
const BUTTON_TIER_CLASS: Record<SettingsButtonTier, string> = {
  primary: "border-focus-accent bg-focus-accent font-semibold text-pane-bg hover:brightness-110",
  secondary: "border-pane-border text-text-primary hover:border-text-secondary",
  danger: "border-lifecycle-danger text-lifecycle-danger hover:bg-lifecycle-danger/10",
  "danger-filled": "border-lifecycle-danger bg-lifecycle-danger font-semibold text-pane-bg hover:brightness-110",
};

export function settingsButtonClass(tier: SettingsButtonTier, className = ""): string {
  return `border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_TIER_CLASS[tier]} ${className}`;
}

type SettingsStatusTone = "success" | "attention" | "danger";
const STATUS_TONE_CLASS: Record<SettingsStatusTone, string> = {
  success: "border-l-lifecycle-success bg-lifecycle-success/10 text-lifecycle-success",
  attention: "border-l-lifecycle-attention bg-lifecycle-attention/10 text-lifecycle-attention",
  danger: "border-l-lifecycle-danger bg-lifecycle-danger/10 text-lifecycle-danger",
};

interface SettingsStatusLineProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone: SettingsStatusTone;
}

export function SettingsStatusLine({ children, className = "", tone, ...props }: SettingsStatusLineProps) {
  return <div role={tone === "danger" ? "alert" : "status"} className={`border-l-2 px-3 py-2 text-sm ${STATUS_TONE_CLASS[tone]} ${className}`} {...props}>{children}</div>;
}
```

## `studio/src/app/shell/PaneShell.tsx`

The common pane treatment is a square, bordered dark panel with a compact uppercase title strip, scrollable content, and a blue focus ring.

```tsx
interface PaneShellProps {
  title?: string;
  children?: React.ReactNode;
}

export function PaneShell({ title, children }: PaneShellProps) {
  return (
    <div className="hide-scrollbars flex h-full flex-col border-r border-pane-border bg-pane-panel outline-none ring-1 ring-focus-accent ring-inset">
      {title ? <div className="h-7 shrink-0 bg-pane-title px-2 text-center text-xs font-bold uppercase leading-7 tracking-wider text-text-primary">{title}</div> : null}
      <div className="flex-1 overflow-auto p-2 text-sm">{children}</div>
    </div>
  );
}
```
