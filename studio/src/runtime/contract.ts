import type { UserNotice } from "./userNotice";
import type { TypedDocumentNode } from "../graphql-foundation/typedDocument";
import type { CreateGraphQlTransportProxy } from "./graphQlTransport";

export type StudioPlatform = "browser" | "desktop";

export interface RuntimeCapabilities {
  /**
   * Whether this platform can serve the project status subscription. The
   * desktop uses its in-process transport and browser development uses the
   * Rust adapter's streaming HTTP transport.
   */
  readonly statusFeed: boolean;
  readonly nativeLifecycle: boolean;
  readonly serviceSupervision: boolean;
  readonly nativeTerminal: boolean;
  readonly nativeFolderPicker: boolean;
  readonly appUpdates: boolean;
}

/** Process-independent desktop service state, including actionable failures. */
export interface ServiceHealth {
  readonly state:
    | "starting"
    | "migrating"
    | "ready"
    | "recovering"
    | "degraded"
    | "failed";
  readonly service: string | null;
  readonly message: string | null;
  readonly logPointer: string | null;
}

export type ServiceHealthListener = (health: ServiceHealth) => void;
export type UserNoticeListener = (notice: UserNotice) => void;

export type WorkTrackerGraphQlExecute = <TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
) => Promise<TResult>;

export interface WorkTrackerReadRoutes<TResult> {
  readonly graphQl: (execute: WorkTrackerGraphQlExecute) => Promise<TResult>;
}

export type SettingsRoutes<TResult> = WorkTrackerReadRoutes<TResult>;

export interface RuntimeStartupConfiguration {
  readonly runtimeInstance?: string;
  readonly serviceHealth: ServiceHealth;
  readonly initialNotices: readonly UserNotice[];
}

export interface AppUpdateCheckResult {
  readonly installedVersion: string;
  readonly status: "current" | "available";
  readonly availableVersion?: string;
  readonly notes?: string;
}

export type AppUpdateCheckErrorCode =
  | "update_feed_unreachable"
  | "update_manifest_invalid"
  | "update_check_failed";

/** Actionable failure from a stable channel update check. */
export class AppUpdateCheckError extends Error {
  readonly name = "AppUpdateCheckError";
  readonly retryable = true;

  constructor(
    readonly code: AppUpdateCheckErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type AppUpdateOperationErrorCode =
  | "update_signature_invalid"
  | "update_download_failed"
  | "update_operation_failed";

/** Actionable failure while applying or restarting into an update. */
export class AppUpdateOperationError extends Error {
  readonly name = "AppUpdateOperationError";

  constructor(
    readonly code: AppUpdateOperationErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface AppUpdateProgress {
  readonly receivedBytes: number;
  readonly totalBytes?: number;
}

export type AppUpdateProgressListener = (progress: AppUpdateProgress) => void;

export interface AppUpdatesRuntime {
  readonly check: () => Promise<AppUpdateCheckResult>;
  readonly downloadAndInstall: () => Promise<void>;
  readonly restart: () => Promise<void>;
  readonly subscribeProgress: (
    listener: AppUpdateProgressListener,
  ) => () => void;
}

export interface CrashCollectionOutcome {
  readonly status: "none" | "report_collected";
}

export interface CrashReportsRuntime {
  readonly latestCollectionOutcome: () => Promise<CrashCollectionOutcome>;
  readonly revealFolder: () => Promise<void>;
}

/** Platform-neutral boundary consumed by the shared Studio application. */
export interface StudioRuntime {
  readonly platform: StudioPlatform;
  readonly capabilities: RuntimeCapabilities;
  readonly appUpdates: AppUpdatesRuntime;
  readonly crashReports?: CrashReportsRuntime;
  /** The configured GraphQL transport used by both imperative reads and Apollo. */
  readonly graphQlTransport: CreateGraphQlTransportProxy;
  readWorkTracker<TResult>(
    routes: WorkTrackerReadRoutes<TResult>,
  ): Promise<TResult>;
  /** Route a WorkTracker command to the platform's sole configured writer. */
  writeWorkTracker<TResult>(
    routes: WorkTrackerReadRoutes<TResult>,
  ): Promise<TResult>;
  readSettings<TResult>(routes: SettingsRoutes<TResult>): Promise<TResult>;
  writeSettings<TResult>(routes: SettingsRoutes<TResult>): Promise<TResult>;
  /**
   * The transport the project status subscription opens on, or null where the
   * platform has none.
   */
  statusStream(): CreateGraphQlTransportProxy | null;
  /**
   * The derived WebSocket URL a browser terminal client attaches through, when
   * this platform serves terminal bytes over HTTP. Optional because the
   * desktop attaches through its own Tauri viewer commands.
   */
  terminalWebSocketUrl?(): string;
  /**
   * The URL a registered document or one of its relative assets is served
   * from. Sandboxed HTML navigates to it and resolves its own relative assets
   * against it, so the path shape must mirror the document's directory levels
   * on every platform. The desktop serves these bytes from its own read-only
   * protocol; browser development still reads them over the legacy host route.
   */
  documentUrl(documentId: string, relPath: string): string;
  pickFolder(): Promise<string | null>;
  retryServices(): Promise<void>;
  startup(): RuntimeStartupConfiguration;
  subscribeServiceHealth(listener: ServiceHealthListener): () => void;
  subscribeUserNotices(listener: UserNoticeListener): () => void;
}
