import type { StudioPlatform } from "../../runtime";

export const KEYMAP_CONTEXT_PRECEDENCE = [
  "modal",
  "capture",
  "focused-pane",
  "global",
] as const;

export type KeymapContext = (typeof KEYMAP_CONTEXT_PRECEDENCE)[number];

export interface KeyChord {
  key: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

export interface EffectiveBinding {
  context: KeymapContext;
  actionId: string;
  chord: KeyChord;
}

export type BindingOverride = EffectiveBinding;

export const MODAL_ACTIONS = {
  close: "modal.close",
  next: "modal.next",
  previous: "modal.previous",
  confirm: "modal.confirm",
  submit: "modal.submit",
} as const;

export interface BindingDefinition extends EffectiveBinding {
  /** Fixed bindings resolve at runtime but are not exposed to user configuration. */
  configurable?: boolean;
  /** Restrict a binding to the runtimes that can actually handle it. */
  platforms?: readonly StudioPlatform[];
  /** Available only while the action uses its default chord. */
  defaultAliases?: readonly KeyChord[];
  /** Available even after a user overrides the primary chord. */
  fixedAliases?: readonly KeyChord[];
  allowExtraModifiers?: boolean;
}

const chord = (
  key: string,
  modifiers: Partial<Omit<KeyChord, "key">> = {},
): KeyChord => ({
  key,
  alt: false,
  control: false,
  meta: false,
  shift: false,
  ...modifiers,
});

const paneBinding = (actionId: string, key: string): BindingDefinition => ({
  context: "focused-pane",
  actionId,
  chord: chord(key),
  allowExtraModifiers: true,
});

const globalBinding = (actionId: string, key: string): BindingDefinition => ({
  context: "global",
  actionId,
  chord: chord(key),
  allowExtraModifiers: true,
});

export const DEFAULT_BINDINGS: readonly BindingDefinition[] = [
  {
    context: "capture",
    actionId: "edit-view.next-zone",
    chord: chord("Tab", { shift: true }),
    configurable: false,
  },
  {
    context: "capture",
    actionId: "edit-view.up",
    chord: chord("ArrowUp"),
    configurable: false,
  },
  {
    context: "capture",
    actionId: "edit-view.down",
    chord: chord("ArrowDown"),
    configurable: false,
  },
  {
    context: "capture",
    actionId: "edit-view.left",
    chord: chord("ArrowLeft"),
    configurable: false,
  },
  {
    context: "capture",
    actionId: "edit-view.right",
    chord: chord("ArrowRight"),
    configurable: false,
  },
  {
    context: "capture",
    actionId: "edit-view.commit",
    chord: chord("Enter"),
    configurable: false,
  },
  { context: "capture", actionId: "cycle-terminal-forward", chord: chord("\\", { meta: true }) },
  {
    context: "capture",
    actionId: "cycle-terminal-backward",
    chord: chord("|", { meta: true, shift: true }),
    defaultAliases: [chord("\\", { meta: true, shift: true })],
  },
  // Capture context on purpose: terminal typing mode hands an engaged terminal
  // every other key, so a focused-pane or global binding would be swallowed
  // exactly where reaching a shell matters most (#667).
  {
    context: "capture",
    actionId: "toggle-terminal-panel",
    chord: chord("`", { control: true }),
  },
  { context: "capture", actionId: "workspace-tab-next", chord: chord("ArrowRight", { meta: true }) },
  { context: "capture", actionId: "workspace-tab-previous", chord: chord("ArrowLeft", { meta: true }) },
  ...Array.from({ length: 10 }, (_, index): BindingDefinition => {
    const position = index + 1;
    return {
      context: "capture",
      actionId: `modules.select-position-${position}`,
      chord: chord(position === 10 ? "0" : String(position), { meta: true }),
      configurable: false,
      platforms: ["desktop"],
    };
  }),

  { context: "modal", actionId: MODAL_ACTIONS.close, chord: chord("Escape") },
  { context: "modal", actionId: MODAL_ACTIONS.next, chord: chord("ArrowDown") },
  { context: "modal", actionId: MODAL_ACTIONS.previous, chord: chord("ArrowUp") },
  { context: "modal", actionId: MODAL_ACTIONS.confirm, chord: chord("Enter") },
  {
    context: "modal",
    actionId: MODAL_ACTIONS.submit,
    chord: chord("Enter", { control: true }),
    defaultAliases: [chord("Enter", { meta: true })],
  },

  paneBinding("modules.next", "ArrowDown"),
  paneBinding("modules.previous", "ArrowUp"),
  paneBinding("modules.activate", "Enter"),
  paneBinding("tasks.next", "ArrowDown"),
  paneBinding("tasks.previous", "ArrowUp"),
  paneBinding("tasks.activate", "Enter"),
  {
    ...paneBinding("tasks.expand", "l"),
    fixedAliases: [chord("ArrowRight")],
  },
  {
    ...paneBinding("tasks.collapse", "h"),
    fixedAliases: [chord("ArrowLeft")],
  },

  globalBinding("search", "/"),
  globalBinding("show-shortcuts", "?"),
  globalBinding("toggle-sidebar", "\\"),
  { ...globalBinding("focus-left", "h"), fixedAliases: [chord("ArrowLeft")] },
  { ...globalBinding("focus-right", "l"), fixedAliases: [chord("ArrowRight")] },
  globalBinding("open-agent", "o"),
  {
    context: "global",
    actionId: "open-agent-command",
    chord: chord("Enter", { meta: true }),
  },
  globalBinding("plan", "n"),
  globalBinding("instant-change", "i"),
  globalBinding("run-now", "r"),
  globalBinding("status", "s"),
  // Settings must also open from an engaged native terminal, where the WebView
  // sees no keydown at all; the native view recognises `Cmd+E` and reports it
  // to `nativeTerminalChords.ts` (#735). Extra modifiers are allowed here, so
  // that chord resolves to this same action on the WebView route.
  globalBinding("settings", "e"),
  globalBinding("set-folder", "f"),
  globalBinding("close-tab", "q"),
  {
    context: "global",
    actionId: "open-with-prompt-command",
    chord: chord("Enter", { meta: true, shift: true }),
  },
  {
    ...globalBinding("open-with-prompt", "Enter"),
    chord: chord("Enter", { shift: true }),
    allowExtraModifiers: false,
  },
] as const;
