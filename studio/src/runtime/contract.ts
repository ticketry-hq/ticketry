import type { UserNotice } from "./userNotice";

export type StudioPlatform = "browser" | "desktop";

export interface RuntimeCapabilities {
  readonly statusFeed: boolean;
  readonly websocketTerminal: boolean;
  readonly nativeLifecycle: boolean;
  readonly serviceSupervision: boolean;
  readonly nativeTerminal: boolean;
  readonly nativeFolderPicker: boolean;
  readonly nativeFileManager: boolean;
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
  pickFolder(): Promise<string | null>;
  /**
   * Hand one URL to the platform's own browser.
   *
   * Studio never renders a third-party page itself: an opened pull request
   * belongs in the browser the user is already logged into GitHub with, not in
   * a webview this application owns. Both platforms can do this, so it is a
   * method rather than a capability — what differs is only who does the
   * opening, and on the desktop that is deliberately the Rust side, which
   * validates the URL before any process is spawned.
   */
  openExternalUrl(url: string): Promise<void>;
  revealInFileManager(path: string): Promise<void>;
  retryServices(): Promise<void>;
  startup(): RuntimeStartupConfiguration;
  subscribeServiceHealth(listener: ServiceHealthListener): () => void;
  subscribeUserNotices(listener: UserNoticeListener): () => void;
}
