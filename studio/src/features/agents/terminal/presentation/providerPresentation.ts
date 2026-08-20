// Provider presentation tokens for terminal surfaces (#694).
//
// Colour on a terminal tab or chip carries exactly two facts: *who* is running
// the conversation (the provider hue) and *whether it is still alive* (a hue at
// all, versus neutral grey). Selection inverts the same pair of colours rather
// than introducing a third, which is why one palette serves both states — a
// contrast ratio is symmetric, so provider-as-ink measures what provider-as-fill
// does.
//
// Lifecycle badges and the keyboard focus ring are separate axes and keep their
// own palettes; nothing here may reuse them.

export type TerminalProvider = "claude" | "codex" | "gemini" | "agy";

const PROVIDER_CLASSES: Record<
  TerminalProvider,
  { fill: string; text: string; edge: string }
> = {
  claude: {
    fill: "bg-provider-claude",
    text: "text-provider-claude",
    edge: "border-provider-claude",
  },
  codex: {
    fill: "bg-provider-codex",
    text: "text-provider-codex",
    edge: "border-provider-codex",
  },
  gemini: {
    fill: "bg-provider-gemini",
    text: "text-provider-gemini",
    edge: "border-provider-gemini",
  },
  agy: {
    fill: "bg-provider-agy",
    text: "text-provider-agy",
    edge: "border-provider-agy",
  },
};

const ENDED_CLASSES = {
  fill: "bg-provider-ended",
  text: "text-provider-ended",
  edge: "border-provider-ended",
};

export function isTerminalProvider(
  agent: string | null | undefined,
): agent is TerminalProvider {
  return !!agent && agent in PROVIDER_CLASSES;
}

/**
 * Provider colour classes shared by terminal tabs, dormant run chips, and the
 * pre-launch agent picker.
 *
 * A live run wears its provider hue: filled with near-black ink when selected,
 * pane ground with provider-coloured ink when not. An ended run (exited, lost,
 * errored) drops the hue entirely for neutral grey in both states — colour means
 * the run is still going. A run whose provider Studio does not recognise is
 * presented the same neutral way rather than guessing a hue.
 *
 * The picker has no run yet. It passes `live: true` to mean "about to run" so
 * every choice keeps its provider hue. Its filtered provider slugs must remain
 * recognised here: an unknown slug uses the same neutral fallback as an ended
 * run and would silently grey out that picker choice.
 */
export function providerToneClasses({
  agent,
  live,
  selected,
  ground,
}: {
  agent: string | null | undefined;
  live: boolean;
  selected: boolean;
  ground: "pane-bg" | "pane-panel";
}): string {
  const classes =
    live && isTerminalProvider(agent) ? PROVIDER_CLASSES[agent] : ENDED_CLASSES;
  const groundClass = ground === "pane-panel" ? "bg-pane-panel" : "bg-pane-bg";
  return selected
    ? `${classes.fill} ${classes.edge} text-provider-ink`
    : `${groundClass} ${classes.edge} ${classes.text}`;
}
