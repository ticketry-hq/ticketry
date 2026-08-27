import type { UserNotice } from "./userNotice";
import type { TypedDocumentNode } from "../graphql-foundation/typedDocument";
import type { CreateGraphQlTransportProxy } from "../graphql-foundation/foundationClient";

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
  readonly serviceHealth: ServiceHealth;
  readonly initialNotices: readonly UserNotice[];
}

/** Platform-neutral boundary consumed by the shared Studio application. */
export interface StudioRuntime {
  readonly platform: StudioPlatform;
  readonly capabilities: RuntimeCapabilities;
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
  /** The browser terminal WebSocket endpoint, when this platform exposes one. */
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
