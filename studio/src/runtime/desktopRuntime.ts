import type {
  RuntimeStartupConfiguration,
  ServiceHealth,
  ServiceHealthListener,
  StudioRuntime,
  UserNoticeListener,
} from "./contract";
import {
  validateUserNotice,
  validateUserNotices,
} from "./userNotice";

type DesktopCommand =
  | "desktop_runtime_configuration"
  | "desktop_retry_services"
  | "desktop_pick_folder";

export type DesktopInvoke = <T>(command: DesktopCommand) => Promise<T>;
export type DesktopRuntimeListen = (
  event: "desktop-service-health" | "desktop-user-notice",
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

export interface DesktopRuntimeOptions {
  readonly invoke: DesktopInvoke;
  readonly listen?: DesktopRuntimeListen;
}

function initializationError(field: string, expectation: string): never {
  throw new Error(`Desktop initialization failed: ${field} ${expectation}`);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function validatePickedFolder(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value === "string" &&
    (value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(value) ||
      value.startsWith("\\\\"))
  ) {
    return value;
  }
  return initializationError(
    "picked folder",
    "must be an absolute path or null",
  );
}

function endpoint(
  source: Record<string, unknown>,
  field: string,
  protocols: readonly string[],
  expectation: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return initializationError(field, expectation);
  }
  try {
    const url = new URL(value);
    if (
      protocols.includes(url.protocol) &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    ) {
      return value;
    }
  } catch {
    // Fall through to the stable public initialization error.
  }
  return initializationError(field, expectation);
}

function validateConfiguration(value: unknown): RuntimeStartupConfiguration {
  const configuration = record(value);
  const endpoints = record(configuration?.endpoints);
  const values = record(configuration?.values);
  const serviceHealth = record(configuration?.serviceHealth);
  if (!configuration || !endpoints || !values || !serviceHealth) {
    return initializationError("configuration", "must include endpoints, values, and serviceHealth");
  }

  const workTrackerApi = endpoint(
    endpoints,
    "workTrackerApi",
    ["http:", "https:"],
    "must be a loopback HTTP(S) URL",
  );
  const agentApi = endpoint(
    endpoints,
    "agentApi",
    ["http:", "https:"],
    "must be a loopback HTTP(S) URL",
  );
  const statusApi = endpoint(
    endpoints,
    "statusApi",
    ["http:", "https:"],
    "must be a loopback HTTP(S) URL",
  );
  const statusWebSocket = endpoint(
    endpoints,
    "statusWebSocket",
    ["ws:", "wss:"],
    "must be a loopback WebSocket URL",
  );
  const terminalWebSocket = endpoint(
    endpoints,
    "terminalWebSocket",
    ["ws:", "wss:"],
    "must be a loopback WebSocket URL",
  );
  const chatWebSocket = endpoint(
    endpoints,
    "chatWebSocket",
    ["ws:", "wss:"],
    "must be a loopback WebSocket URL",
  );
  const workTrackerApiKey = values.workTrackerApiKey;
  if (typeof workTrackerApiKey !== "string") {
    return initializationError("workTrackerApiKey", "must be a string");
  }
  const state = serviceHealth.state;
  if (![
    "starting",
    "migrating",
    "ready",
    "recovering",
    "degraded",
    "failed",
  ].includes(String(state))) {
    return initializationError("serviceHealth.state", "must be a stable service-health state");
  }
  for (const field of ["service", "message", "logPointer"] as const) {
    if (serviceHealth[field] !== null && typeof serviceHealth[field] !== "string") {
      return initializationError(`serviceHealth.${field}`, "must be a string or null");
    }
  }

  return Object.freeze({
    endpoints: Object.freeze({
      workTrackerApi,
      agentApi,
      statusApi,
      statusWebSocket,
      terminalWebSocket,
      chatWebSocket,
    }),
    values: Object.freeze({ workTrackerApiKey }),
    serviceHealth: Object.freeze({
      state: state as RuntimeStartupConfiguration["serviceHealth"]["state"],
      service: serviceHealth.service as string | null,
      message: serviceHealth.message as string | null,
      logPointer: serviceHealth.logPointer as string | null,
    }),
    initialNotices: validateUserNotices(configuration.initialNotices),
  });
}

function serviceHealth(value: unknown): ServiceHealth | null {
  const recordValue = record(value);
  if (!recordValue) return null;
  try {
    return validateConfiguration({
      endpoints: {
        workTrackerApi: "http://127.0.0.1:1/api/work-tracker",
        agentApi: "http://127.0.0.1:1/api",
        statusApi: "http://127.0.0.1:1/api",
        statusWebSocket: "ws://127.0.0.1:1/ws/status",
        terminalWebSocket: "ws://127.0.0.1:1/ws/terminal",
        chatWebSocket: "ws://127.0.0.1:1/ws/chat",
      },
      values: { workTrackerApiKey: "" },
      serviceHealth: recordValue,
    }).serviceHealth;
  } catch {
    return null;
  }
}

/** Load the desktop-only startup values before the shared Studio mounts. */
export async function createDesktopRuntime({
  invoke,
  listen,
}: DesktopRuntimeOptions): Promise<StudioRuntime> {
  const startup = validateConfiguration(
    await invoke<unknown>("desktop_runtime_configuration"),
  );
  const deliveredNoticeIds = new Set(
    startup.initialNotices.map((notice) => notice.id),
  );

  return Object.freeze({
    platform: "desktop" as const,
    capabilities: Object.freeze({
      statusFeed: true,
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
    }),
    pickFolder: async () =>
      validatePickedFolder(await invoke<unknown>("desktop_pick_folder")),
    retryServices: async () => {
      await invoke<void>("desktop_retry_services");
    },
    startup: () => startup,
    subscribeServiceHealth: (listener: ServiceHealthListener) => {
      listener(startup.serviceHealth);
      if (!listen) return () => {};
      let active = true;
      let unlisten: (() => void) | undefined;
      void listen("desktop-service-health", (event) => {
        const health = serviceHealth(event.payload);
        if (active && health) listener(health);
      }).then((stop) => {
        unlisten = stop;
        if (!active) stop();
      });
      return () => {
        active = false;
        unlisten?.();
      };
    },
    subscribeUserNotices: (listener: UserNoticeListener) => {
      if (!listen) return () => {};
      let active = true;
      let unlisten: (() => void) | undefined;
      void listen("desktop-user-notice", (event) => {
        const notice = validateUserNotice(event.payload);
        if (!active || !notice || deliveredNoticeIds.has(notice.id)) return;
        deliveredNoticeIds.add(notice.id);
        listener(notice);
      }).then((stop) => {
        unlisten = stop;
        if (!active) stop();
      });
      return () => {
        active = false;
        unlisten?.();
      };
    },
  });
}
