import { createBrowserRuntime } from "./browserRuntime";
import type { RuntimeStartupConfiguration, StudioRuntime } from "./contract";

export type {
  RuntimeCapabilities,
  RuntimeEndpoints,
  ServiceHealth,
  ServiceHealthListener,
  RuntimeStartupConfiguration,
  RuntimeValues,
  StudioPlatform,
  StudioRuntime,
} from "./contract";
export { createBrowserRuntime } from "./browserRuntime";

let installedRuntime: StudioRuntime | null = null;

function defaultBrowserRuntime(): StudioRuntime {
  return createBrowserRuntime({
    environment: {
      VITE_WT_API_BASE: import.meta.env.VITE_WT_API_BASE,
      VITE_WT_API_KEY: import.meta.env.VITE_WT_API_KEY,
      VITE_AGENT_API_BASE: import.meta.env.VITE_AGENT_API_BASE,
    },
  });
}

/** Install the runtime before the React application mounts. */
export function initializeStudioRuntime(runtime: StudioRuntime): void {
  // Read once during startup so malformed configuration fails before any API
  // or socket can be opened.
  runtime.startup();
  installedRuntime = runtime;
}

export function initializeBrowserRuntime(): void {
  initializeStudioRuntime(defaultBrowserRuntime());
}

export function studioRuntime(): StudioRuntime {
  return installedRuntime ?? defaultBrowserRuntime();
}

export function runtimeConfiguration(): RuntimeStartupConfiguration {
  return studioRuntime().startup();
}

/** Resolve an existing canonical /api path against the runtime's agent root. */
export function agentApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = runtimeConfiguration().endpoints.agentApi.replace(/\/$/, "");
  const suffix = path === "/api"
    ? ""
    : path.startsWith("/api/")
      ? path.slice(4)
      : path.startsWith("/")
        ? path
        : `/${path}`;
  return `${base}${suffix}`;
}

export function statusWebSocketUrl(): string {
  return runtimeConfiguration().endpoints.statusWebSocket;
}

export function terminalWebSocketUrl(): string {
  return runtimeConfiguration().endpoints.terminalWebSocket;
}
