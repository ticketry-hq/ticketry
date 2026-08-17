import {
  presentLifecycle,
  type LifecycleTone,
  type TerminalPresentationState,
} from "./lifecycle";

// Tone → border/text classes. The attention tones (amber/red) read distinctly
// from the focus-accent blue used by running-agent counts, keeping the two
// axes visually separate as the ticket requires.
const TONE_CLASS: Record<LifecycleTone, string> = {
  active: "border-lifecycle-active/60 text-lifecycle-active",
  attention: "border-lifecycle-attention/70 text-lifecycle-attention",
  danger: "border-lifecycle-danger/70 text-lifecycle-danger",
  idle: "border-lifecycle-idle/70 text-lifecycle-idle",
  muted: "border-pane-border text-text-muted",
  neutral: "border-pane-border text-text-muted",
  success: "border-lifecycle-success/70 text-lifecycle-success",
};

/**
 * Compact lifecycle/attention badge shared by terminal tabs and the task tree.
 *
 * Renders a single-glyph + short-label chip whose color encodes how much the
 * session wants the user. Renders nothing for states with no label (`unknown`),
 * so an unwired or degraded session stays silent rather than guessing.
 *
 * - :param state: the normalized lifecycle state to present.
 */
export function LifecycleBadge({
  state,
  count = 1,
  showLabel = true,
  alwaysShowCount = false,
}: {
  state: TerminalPresentationState;
  count?: number;
  showLabel?: boolean;
  alwaysShowCount?: boolean;
}) {
  const p = presentLifecycle(state);

  // Blank label (e.g. `unknown`) means there is nothing honest to show.
  if (!p.label) return null;

  // Spin only the reconnecting glyph to signal in-flight transport recovery.
  const spin = state === "reconnecting";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 border bg-pane-bg px-1 text-[10px] font-bold leading-4 ${TONE_CLASS[p.tone]}`}
      title={p.title}
      aria-label={p.title}
    >
      <span aria-hidden="true" className={spin ? "animate-spin" : undefined}>
        {p.glyph}
      </span>
      {showLabel && <span>{p.label}</span>}
      {(alwaysShowCount || count > 1) && <span>{count}</span>}
    </span>
  );
}
