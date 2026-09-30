/**
 * CODING-1486 / CODING-1487 — which terminal renderer a Studio build presents.
 *
 * Desktop builds render terminals with embedded native libghostty: the
 * validated tmux attach command runs inside libghostty's own PTY and terminal
 * bytes never enter the WebView. xterm is the compatibility renderer on every
 * surface, and browser development renders with it over the existing
 * WebSocket adapter.
 *
 * CODING-1487 archived the third choice, the Ghostty WASM renderer, onto
 * `archive/CODING-1487-ghostty-wasm`. It is no longer a renderer: a stale
 * launch flag or stored setting naming it parses as unknown and the surface
 * default wins.
 *
 * Development builds may still force native-vs-xterm for diagnostics;
 * packaged builds always use the product default.
 *
 * Selection changes nothing about the run, tmux session identity, or persisted
 * terminal record: every renderer attaches the same durable viewer.
 */

export type TerminalRendererChoice = "native" | "xterm";

/** Where the gate is read from, in precedence order. */
export const RENDERER_QUERY_PARAM = "terminalRenderer";
export const RENDERER_STORAGE_KEY = "ticketry:terminal-renderer";

const CHOICES: readonly TerminalRendererChoice[] = ["native", "xterm"];

/** Embedded native libghostty owns the desktop terminal surface. */
export const DESKTOP_DEFAULT_TERMINAL_RENDERER: TerminalRendererChoice = "native";
/** Browser development has no native surface, so it renders with xterm. */
export const BROWSER_DEFAULT_TERMINAL_RENDERER: TerminalRendererChoice = "xterm";

/** The product default for a surface, before any development override. */
export function defaultTerminalRenderer(desktop: boolean): TerminalRendererChoice {
  return desktop
    ? DESKTOP_DEFAULT_TERMINAL_RENDERER
    : BROWSER_DEFAULT_TERMINAL_RENDERER;
}

export interface RendererGateInput {
  /** `location.search` of the Studio document. */
  search?: string;
  /** A `localStorage`-shaped store; omitted when storage is unavailable. */
  storage?: Pick<Storage, "getItem">;
  /** False in packaged release builds, where diagnostic overrides stay unreachable. */
  developmentBuild: boolean;
  /** True inside the Tauri shell, where the native surface exists. */
  desktop: boolean;
}

function parse(value: string | null | undefined): TerminalRendererChoice | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return CHOICES.includes(normalized as TerminalRendererChoice)
    ? (normalized as TerminalRendererChoice)
    : null;
}

/**
 * Resolve the renderer choice. A development launch flag
 * (`?terminalRenderer=…`) wins over the stored development setting so one
 * window can be compared against another. Packaged builds always use the
 * product default for their surface.
 */
export function selectedTerminalRenderer(
  input: RendererGateInput,
): TerminalRendererChoice {
  const productDefault = defaultTerminalRenderer(input.desktop);
  if (!input.developmentBuild) return productDefault;
  let fromQuery: TerminalRendererChoice | null = null;
  try {
    fromQuery = parse(new URLSearchParams(input.search ?? "").get(RENDERER_QUERY_PARAM));
  } catch {
    /* A malformed query string is not a reason to fail the terminal. */
  }
  if (fromQuery) return fromQuery;
  try {
    return parse(input.storage?.getItem(RENDERER_STORAGE_KEY)) ?? productDefault;
  } catch {
    /* Storage can be unavailable; fall back to the default renderer. */
    return productDefault;
  }
}

/** Read the gate from the live document. */
export function currentTerminalRenderer(desktop: boolean): TerminalRendererChoice {
  if (typeof window === "undefined") return defaultTerminalRenderer(desktop);
  let storage: Pick<Storage, "getItem"> | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return selectedTerminalRenderer({
    search: window.location?.search,
    storage,
    developmentBuild: import.meta.env.DEV === true,
    desktop,
  });
}
