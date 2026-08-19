import type { UserNotice } from "./userNotice";
import type { TypedDocumentNode } from "../graphql-foundation/typedDocument";
import type { CreateGraphQlTransportProxy } from "../graphql-foundation/foundationClient";

export type StudioPlatform = "browser" | "desktop";

export interface RuntimeCapabilities {
  /**
   * Whether this platform can serve the project status subscription. The
   * status WebSocket was retired at the Slice 3 handoff, so the durable
   * GraphQL subscription over the in-process transport is the only status
   * authority — and a platform without that transport simply has no status
   * feed rather than a second, weaker one.
   */
  readonly statusFeed: boolean;
  readonly websocketTerminal: boolean;
  readonly nativeLifecycle: boolean;
  readonly serviceSupervision: boolean;
  readonly nativeTerminal: boolean;
  readonly nativeFolderPicker: boolean;
}

export interface RuntimeEndpoints {
  readonly workTrackerApi: string;
  readonly agentApi: string;
  readonly statusApi: string;
  readonly terminalWebSocket: string;
}

export interface RuntimeValues {
  readonly workTrackerApiKey: string;
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
  readonly rest: () => Promise<TResult>;
  readonly graphQl: (execute: WorkTrackerGraphQlExecute) => Promise<TResult>;
}

export type SettingsRoutes<TResult> = WorkTrackerReadRoutes<TResult>;

export interface RuntimeStartupConfiguration {
  readonly endpoints: RuntimeEndpoints;
  readonly values: RuntimeValues;
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
   * The transport the project status subscription opens on, or null where this
   * platform has none. Studio never falls back to another status source.
   */
  statusStream(): CreateGraphQlTransportProxy | null;
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
