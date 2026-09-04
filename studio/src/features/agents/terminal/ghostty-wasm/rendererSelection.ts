/**
 * CODING-1304 — which terminal renderer a Studio build presents.
 *
 * Native libghostty is the default in development and packaged desktop builds.
 * `ghostty-wasm` remains the browser default and xterm is the compatibility
 * fallback. Development builds may still select another renderer for
 * comparison. Selection changes nothing
 * about the run, the tmux session identity, or any persisted terminal record:
 * all three renderers attach the same durable viewer through the same transport.
 */

export type TerminalRendererChoice = "native" | "xterm" | "ghostty-wasm";

/** Where the gate is read from, in precedence order. */
export const RENDERER_QUERY_PARAM = "terminalRenderer";
export const RENDERER_STORAGE_KEY = "ticketry:terminal-renderer";

const CHOICES: readonly TerminalRendererChoice[] = ["native", "xterm", "ghostty-wasm"];

export interface RendererGateInput {
  /** `location.search` of the Studio document. */
  search?: string;
  /** A `localStorage`-shaped store; omitted when storage is unavailable. */
  storage?: Pick<Storage, "getItem">;
  /** Whether this document is running inside the Tauri desktop application. */
  desktopApp: boolean;
  /** False in packaged release builds, where renderer overrides stay unreachable. */
  developmentBuild: boolean;
}

function parse(value: string | null | undefined): TerminalRendererChoice | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return CHOICES.includes(normalized as TerminalRendererChoice)
    ? (normalized as TerminalRendererChoice)
    : null;
}

/**
 * Resolve the requested development renderer or use the shipping default.
 * A launch flag (`?terminalRenderer=…`) wins over the stored development
 * setting so one window can be compared against another.
 */
export function selectedTerminalRenderer(
  input: RendererGateInput,
): TerminalRendererChoice {
  const defaultRenderer = input.desktopApp ? "native" : "ghostty-wasm";
  if (!input.developmentBuild) return defaultRenderer;
  let fromQuery: TerminalRendererChoice | null = null;
  try {
    fromQuery = parse(new URLSearchParams(input.search ?? "").get(RENDERER_QUERY_PARAM));
  } catch {
    /* A malformed query string is not a reason to fail the terminal. */
  }
  if (fromQuery) return fromQuery;
  try {
    return parse(input.storage?.getItem(RENDERER_STORAGE_KEY)) ?? defaultRenderer;
  } catch {
    /* Storage can be unavailable; use the shipping default renderer. */
    return defaultRenderer;
  }
}

/** Read the renderer choice from the live document. */
export function currentTerminalRenderer(desktopApp: boolean): TerminalRendererChoice {
  if (typeof window === "undefined") return "ghostty-wasm";
  let storage: Pick<Storage, "getItem"> | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return selectedTerminalRenderer({
    search: window.location?.search,
    storage,
    desktopApp,
    developmentBuild: import.meta.env.DEV === true,
  });
}
