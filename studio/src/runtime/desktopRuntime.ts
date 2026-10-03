import type { StudioRuntime } from "./contract";
import { validateDesktopConfiguration } from "./desktopRuntimeConfiguration";
import { desktopAppUpdates } from "./desktopAppUpdates";
import { desktopDirectoryTrust } from "./desktopDirectoryTrust";
import { desktopCrashReports } from "./desktopCrashReports";
import { desktopRuntimeEvents } from "./desktopRuntimeEvents";
import {
  executeGraphQlTransport,
  type CreateGraphQlTransportProxy,
} from "./graphQlTransport";
import { createTauRPCProxy } from "../graphql-foundation/generated/taurpc";
import { desktopDocumentUrl } from "./documentAssetUrl";
import { desktopLaunchkeyMidi } from "./desktopLaunchkeyMidi";
import type { LaunchkeyMidiRuntime } from "./launchkey";

type DesktopCommand =
  | "desktop_runtime_configuration"
  | "desktop_retry_services"
  | "desktop_pick_folder"
  | "desktop_update_check"
  | "desktop_update_download_and_install"
  | "desktop_update_restart"
  | "desktop_latest_crash_collection_outcome"
  | "desktop_reveal_crash_report_folder"
  | "desktop_prepare_directory_trust"
  | "desktop_toggle_handy_transcription"
  | "viewer_input";

export type DesktopInvoke = <T>(
  command: DesktopCommand,
  args?: Record<string, unknown>,
) => Promise<T>;
export type DesktopRuntimeListen = (
  event:
    | "desktop-service-health"
    | "desktop-user-notice"
    | "desktop-update-progress",
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

export interface DesktopRuntimeOptions {
  readonly invoke: DesktopInvoke;
  readonly listen?: DesktopRuntimeListen;
  readonly createGraphQlProxy?: CreateGraphQlTransportProxy;
  readonly launchkeyMidi?: LaunchkeyMidiRuntime;
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
  throw new Error("Desktop initialization failed: picked folder must be an absolute path or null");
}

/** Load the desktop-only startup values before the shared Studio mounts. */
export async function createDesktopRuntime({
  invoke,
  listen,
  createGraphQlProxy = createTauRPCProxy,
  launchkeyMidi = desktopLaunchkeyMidi,
}: DesktopRuntimeOptions): Promise<StudioRuntime> {
  const startup = validateDesktopConfiguration(
    await invoke<unknown>("desktop_runtime_configuration"),
  );
  const readWorkTracker: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.graphQl((document, variables) => executeGraphQlTransport(
      document,
      variables,
      createGraphQlProxy,
    ));

  return Object.freeze({
    platform: "desktop" as const,
    serviceRecovery: "restart" as const,
    graphQlTransport: createGraphQlProxy,
    launchkey: Object.freeze({
      midi: () => launchkeyMidi,
      toggleHandyTranscription: async () => {
        await invoke<void>("desktop_toggle_handy_transcription").catch(() => {});
      },
      submitTerminal: async (viewerHandle: string) => {
        await invoke<void>("viewer_input", { viewerHandle, data: [13] });
      },
    }),
    capabilities: Object.freeze({
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
      appUpdates: true,
    }),
    readWorkTracker,
    writeWorkTracker: readWorkTracker,
    readSettings: readWorkTracker,
    writeSettings: readWorkTracker,
    statusStream: () => createGraphQlProxy,
    documentUrl: (documentId: string, relPath: string) =>
      desktopDocumentUrl(documentId, relPath),
    prepareDirectoryTrust: desktopDirectoryTrust(invoke),
    appUpdates: desktopAppUpdates(invoke, listen),
    crashReports: desktopCrashReports(invoke),
    pickFolder: async () =>
      validatePickedFolder(await invoke<unknown>("desktop_pick_folder")),
    retryServices: async () => {
      await invoke<void>("desktop_retry_services");
    },
    plannerEndpoint: async () => validateDesktopConfiguration(
      await invoke<unknown>("desktop_runtime_configuration"),
    ).plannerEndpoint ?? null,
    startup: () => startup,
    ...desktopRuntimeEvents(startup, invoke, listen),
  });
}
