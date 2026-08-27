import { createBrowserRuntime } from "./browserRuntime";
import type { RuntimeStartupConfiguration, StudioRuntime } from "./contract";

export type {
  RuntimeCapabilities,
  ServiceHealth,
  ServiceHealthListener,
  RuntimeStartupConfiguration,
  SettingsRoutes,
  StudioPlatform,
  StudioRuntime,
  UserNoticeListener,
  WorkTrackerGraphQlExecute,
  WorkTrackerReadRoutes,
} from "./contract";
export {
  USER_NOTICE_SEVERITIES,
  validateUserNotice,
  validateUserNotices,
  type UserNotice,
  type UserNoticeSeverity,
} from "./userNotice";
export { createBrowserRuntime } from "./browserRuntime";

let installedRuntime: StudioRuntime | null = null;
let fallbackRuntime: StudioRuntime | null = null;

function defaultBrowserRuntime(): StudioRuntime {
  fallbackRuntime ??= createBrowserRuntime({
    environment: {
      VITE_GRAPHQL_API: import.meta.env.VITE_GRAPHQL_API,
    },
  });
  return fallbackRuntime;
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

/** The transport the project status subscription opens on, if any. */
export function statusStreamTransport() {
  return studioRuntime().statusStream();
}

/** The WebSocket URL the browser terminal client attaches through. */
export function terminalWebSocketUrl(): string {
  const endpoint = studioRuntime().terminalWebSocketUrl?.();
  if (!endpoint) {
    throw new Error("This Studio platform has no browser terminal WebSocket endpoint.");
  }
  return endpoint;
}
