import type {
  RuntimeStartupConfiguration,
  ServiceHealthListener,
  StudioRuntime,
} from "./contract";

export interface BrowserRuntimeEnvironment {
  readonly VITE_WT_API_BASE?: string;
  readonly VITE_WT_API_KEY?: string;
  readonly VITE_AGENT_API_BASE?: string;
}

export interface BrowserRuntimeOptions {
  readonly environment: BrowserRuntimeEnvironment;
}

const DEFAULT_WORKTRACKER_API = "/api/work-tracker";
const DEFAULT_AGENT_API = "/api";
const DEFAULT_STATUS_WEBSOCKET = "/ws/status";
const DEFAULT_TERMINAL_WEBSOCKET = "/ws/terminal";

function invalid(field: string, expectation: string): never {
  throw new Error(
    `Invalid Studio runtime configuration: ${field} ${expectation}`,
  );
}

function validateHttpEndpoint(field: string, value: string): string {
  if (value !== value.trim() || value.length === 0) {
    return invalid(field, "must not be empty or contain surrounding whitespace");
  }
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    // Report the same stable contract error for every invalid URL shape.
  }
  return invalid(field, "must be a relative path or an HTTP(S) URL");
}

function websocketEndpoint(apiEndpoint: string, path: string): string {
  if (apiEndpoint.startsWith("/")) return path;
  const url = new URL(path, new URL(apiEndpoint).origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Browser implementation of the shared Studio runtime boundary. */
export function createBrowserRuntime({
  environment,
}: BrowserRuntimeOptions): StudioRuntime {
  const workTrackerApi = validateHttpEndpoint(
    "workTrackerApi",
    environment.VITE_WT_API_BASE || DEFAULT_WORKTRACKER_API,
  );
  const agentApi = validateHttpEndpoint(
    "agentApi",
    environment.VITE_AGENT_API_BASE || DEFAULT_AGENT_API,
  );
  const startup: RuntimeStartupConfiguration = Object.freeze({
    endpoints: Object.freeze({
      workTrackerApi,
      agentApi,
      statusApi: agentApi,
      statusWebSocket: websocketEndpoint(agentApi, DEFAULT_STATUS_WEBSOCKET),
      terminalWebSocket: websocketEndpoint(agentApi, DEFAULT_TERMINAL_WEBSOCKET),
    }),
    values: Object.freeze({
      workTrackerApiKey: environment.VITE_WT_API_KEY || "",
    }),
    serviceHealth: Object.freeze({
      state: "ready",
      service: "backend",
      message: null,
      logPointer: null,
    }),
    initialNotices: Object.freeze([]),
  });

  return Object.freeze({
    platform: "browser" as const,
    capabilities: Object.freeze({
      statusFeed: true,
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: false,
      nativeTerminal: false,
      nativeFolderPicker: false,
      nativeFileManager: false,
    }),
    pickFolder: async () => null,
    openExternalUrl: async (url: string) => {
      // `noopener` matters even for a page Studio trusts: without it the opened
      // tab keeps a handle on this window and could navigate it.
      window.open(url, "_blank", "noopener,noreferrer");
    },
    revealInFileManager: async () => {
      throw new Error("The system file manager is available only in desktop Studio");
    },
    retryServices: async () => {
      throw new Error("Service recovery is available only in desktop Studio");
    },
    startup: () => startup,
    subscribeServiceHealth: (listener: ServiceHealthListener) => {
      listener(startup.serviceHealth);
      return () => {};
    },
    subscribeUserNotices: () => () => {},
  });
}
