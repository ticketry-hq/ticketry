export type FrontendLogLevel = "debug" | "info" | "warn" | "error";

export type FrontendLogInvoke = (
  command: "desktop_append_frontend_log",
  args: { level: FrontendLogLevel; message: string },
) => Promise<unknown>;

type ConsoleMethod = "debug" | "log" | "info" | "warn" | "error";

const MAX_FORMATTED_CHARACTERS = 12_000;
const LEVEL_BY_METHOD: Record<ConsoleMethod, FrontendLogLevel> = {
  debug: "debug",
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
};

function jsonValue(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, candidate: unknown) => {
      if (typeof candidate === "bigint") return `${candidate}n`;
      if (candidate instanceof Error) {
        return {
          name: candidate.name,
          message: candidate.message,
          stack: candidate.stack,
        };
      }
      if (typeof candidate === "object" && candidate !== null) {
        if (seen.has(candidate)) return "[Circular]";
        seen.add(candidate);
      }
      return candidate;
    });
  } catch {
    return undefined;
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  const json = jsonValue(value);
  if (json !== undefined) return json;
  try {
    return String(value);
  } catch {
    return "[Unformattable value]";
  }
}

export function formatFrontendLogValues(values: readonly unknown[]): string {
  const formatted = values.map(formatValue).join(" ");
  if (formatted.length <= MAX_FORMATTED_CHARACTERS) return formatted;
  return `${formatted.slice(0, MAX_FORMATTED_CHARACTERS)} [truncated]`;
}

export interface FrontendLogBridgeOptions {
  invoke: FrontendLogInvoke;
  targetConsole?: Console;
  targetWindow?: Window;
}

/**
 * Mirror development webview diagnostics to Ticketry's fixed persistent log.
 * Original console behavior is preserved, and persistence failures are
 * deliberately ignored so diagnostics can never affect application behavior.
 */
export function installFrontendLogBridge({
  invoke,
  targetConsole = console,
  targetWindow = window,
}: FrontendLogBridgeOptions): () => void {
  const originals = new Map<ConsoleMethod, (...values: unknown[]) => void>();
  const wrappers = new Map<ConsoleMethod, (...values: unknown[]) => void>();

  const persist = (level: FrontendLogLevel, values: readonly unknown[]) => {
    const message = formatFrontendLogValues(values);
    void invoke("desktop_append_frontend_log", { level, message }).catch(() => undefined);
  };

  for (const method of Object.keys(LEVEL_BY_METHOD) as ConsoleMethod[]) {
    const original = targetConsole[method] as (
      ...values: unknown[]
    ) => void;
    const wrapper = (...values: unknown[]) => {
      original.apply(targetConsole, values);
      persist(LEVEL_BY_METHOD[method], values);
    };
    originals.set(method, original);
    wrappers.set(method, wrapper);
    targetConsole[method] = wrapper;
  }

  const onWindowError = (event: ErrorEvent) => {
    persist("error", ["[window.error]", event.error ?? event.message]);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    persist("error", ["[unhandledrejection]", event.reason]);
  };
  targetWindow.addEventListener("error", onWindowError);
  targetWindow.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    for (const method of Object.keys(LEVEL_BY_METHOD) as ConsoleMethod[]) {
      if (targetConsole[method] === wrappers.get(method)) {
        targetConsole[method] = originals.get(method)!;
      }
    }
    targetWindow.removeEventListener("error", onWindowError);
    targetWindow.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
