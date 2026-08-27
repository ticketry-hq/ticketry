import type {
  RuntimeStartupConfiguration,
  ServiceHealth,
  ServiceHealthListener,
  StudioRuntime,
  UserNoticeListener,
} from "./contract";
import {
  executeGraphQlTransport,
  type CreateGraphQlTransportProxy,
} from "./graphQlTransport";
import { createTauRPCProxy } from "../graphql-foundation/generated/taurpc";
import { desktopDocumentUrl } from "./documentAssetUrl";
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
  readonly createGraphQlProxy?: CreateGraphQlTransportProxy;
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

function validateConfiguration(value: unknown): RuntimeStartupConfiguration {
  const configuration = record(value);
  const serviceHealth = record(configuration?.serviceHealth);
  if (!configuration || !serviceHealth) {
    return initializationError("configuration", "must include serviceHealth");
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
  const state = recordValue.state;
  if (!["starting", "migrating", "ready", "recovering", "degraded", "failed"].includes(String(state))) return null;
  for (const field of ["service", "message", "logPointer"] as const) {
    if (recordValue[field] !== null && typeof recordValue[field] !== "string") return null;
  }
  return {
    state: state as ServiceHealth["state"],
    service: recordValue.service as string | null,
    message: recordValue.message as string | null,
    logPointer: recordValue.logPointer as string | null,
  };
}

/** Load the desktop-only startup values before the shared Studio mounts. */
export async function createDesktopRuntime({
  invoke,
  listen,
  createGraphQlProxy = createTauRPCProxy,
}: DesktopRuntimeOptions): Promise<StudioRuntime> {
  const startup = validateConfiguration(
    await invoke<unknown>("desktop_runtime_configuration"),
  );
  const deliveredNoticeIds = new Set(
    startup.initialNotices.map((notice) => notice.id),
  );
  const readWorkTracker: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.graphQl((document, variables) => executeGraphQlTransport(
      document,
      variables,
      createGraphQlProxy,
    ));

  return Object.freeze({
    platform: "desktop" as const,
    graphQlTransport: createGraphQlProxy,
    capabilities: Object.freeze({
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
    }),
    readWorkTracker,
    writeWorkTracker: readWorkTracker,
    readSettings: readWorkTracker,
    writeSettings: readWorkTracker,
    statusStream: () => createGraphQlProxy,
    documentUrl: (documentId: string, relPath: string) =>
      desktopDocumentUrl(documentId, relPath),
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
