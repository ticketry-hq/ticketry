import type { UserNotice } from "./userNotice";
import type { TypedDocumentNode } from "../graphql-foundation/typedDocument";

export type StudioPlatform = "browser" | "desktop";

export interface RuntimeCapabilities {
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
  readonly statusWebSocket: string;
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
  pickFolder(): Promise<string | null>;
  retryServices(): Promise<void>;
  startup(): RuntimeStartupConfiguration;
  subscribeServiceHealth(listener: ServiceHealthListener): () => void;
  subscribeUserNotices(listener: UserNoticeListener): () => void;
}
