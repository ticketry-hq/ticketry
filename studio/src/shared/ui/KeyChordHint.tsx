import type { ReactNode } from "react";

export type KeyBadgeTone = "accent" | "engaged";

const TONE_CLASS: Record<KeyBadgeTone, string> = {
  accent: "text-focus-accent",
  engaged: "text-lifecycle-success",
};

/** Keyboard chord rendered as a dark badge, e.g. ⇧Tab or \. */
export function KeyBadge({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: KeyBadgeTone;
}) {
  return (
    <span className={`bg-pane-bg px-1.5 py-0.5 font-bold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/** KeyBadge followed by "— label", as shown in the footer hint bar. */
export function KeyChordHint({
  chord,
  label,
  tone,
}: {
  chord: string;
  label: string;
  tone?: KeyBadgeTone;
}) {
  return (
    <span className="flex items-center gap-1">
      <KeyBadge tone={tone}>{chord}</KeyBadge>
      <span className="text-text-muted">— {label}</span>
    </span>
  );
}
