import type {
  RuntimeStartupConfiguration,
  ServiceHealthListener,
  StudioRuntime,
} from "./contract";
import { encodeDocumentPath } from "./documentAssetUrl";

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
  const readWorkTracker: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.rest();

  return Object.freeze({
    platform: "browser" as const,
    capabilities: Object.freeze({
      // Browser development has no in-process GraphQL transport, and the
      // status WebSocket it used to fall back to no longer exists.
      statusFeed: false,
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: false,
      nativeTerminal: false,
      nativeFolderPicker: false,
    }),
    readWorkTracker,
    // Browser-only development remains a supporting tool while the shipping
    // desktop path uses in-process GraphQL as the single WorkTracker writer.
    writeWorkTracker: readWorkTracker,
    readSettings: readWorkTracker,
    writeSettings: readWorkTracker,
    statusStream: () => null,
    // Browser development has no desktop protocol, so document bytes keep
    // coming from the legacy host route it already talks to.
    documentUrl: (documentId: string, relPath: string) =>
      `${agentApi.replace(/\/$/, "")}/docs/${encodeURIComponent(documentId)}/${
        encodeDocumentPath(relPath)
      }`,
    pickFolder: async () => null,
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
