/**
 * CODIN-1514 — which terminal renderer a Studio build presents.
 *
 * `ghostty-wasm` is the product default. Development builds can force the
 * native or xterm renderer for diagnostics. Selection changes nothing about
 * the run, tmux session identity, or persisted terminal record: all three
 * renderers attach the same durable viewer through the same transport.
 */

export type TerminalRendererChoice = "native" | "xterm" | "ghostty-wasm";

/** Where the gate is read from, in precedence order. */
export const RENDERER_QUERY_PARAM = "terminalRenderer";
export const RENDERER_STORAGE_KEY = "ticketry:terminal-renderer";

const CHOICES: readonly TerminalRendererChoice[] = ["native", "xterm", "ghostty-wasm"];
export const DEFAULT_TERMINAL_RENDERER: TerminalRendererChoice = "ghostty-wasm";

export interface RendererGateInput {
  /** `location.search` of the Studio document. */
  search?: string;
  /** A `localStorage`-shaped store; omitted when storage is unavailable. */
  storage?: Pick<Storage, "getItem">;
  /** False in packaged release builds, where diagnostic overrides stay unreachable. */
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
 * Resolve the renderer choice. A development launch flag
 * (`?terminalRenderer=…`) wins over the stored development setting so one
 * window can be compared against another. Packaged builds always use the
 * product default.
 */
export function selectedTerminalRenderer(
  input: RendererGateInput,
): TerminalRendererChoice {
  if (!input.developmentBuild) return DEFAULT_TERMINAL_RENDERER;
  let fromQuery: TerminalRendererChoice | null = null;
  try {
    fromQuery = parse(new URLSearchParams(input.search ?? "").get(RENDERER_QUERY_PARAM));
  } catch {
    /* A malformed query string is not a reason to fail the terminal. */
  }
  if (fromQuery) return fromQuery;
  try {
    return parse(input.storage?.getItem(RENDERER_STORAGE_KEY)) ?? DEFAULT_TERMINAL_RENDERER;
  } catch {
    /* Storage can be unavailable; fall back to the default renderer. */
    return DEFAULT_TERMINAL_RENDERER;
  }
}

/** Read the gate from the live document. */
export function currentTerminalRenderer(): TerminalRendererChoice {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_RENDERER;
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
  });
}
