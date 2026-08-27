import type {
  RuntimeStartupConfiguration,
  ServiceHealthListener,
  StudioRuntime,
} from "./contract";
import { executeFoundationOperation } from "../graphql-foundation/foundationClient";
import type { GraphQlTransportProxy } from "../graphql-foundation/generated/taurpc";
import { encodeDocumentPath } from "./documentAssetUrl";

export interface BrowserRuntimeEnvironment {
  readonly VITE_GRAPHQL_API?: string;
}

export interface BrowserRuntimeOptions {
  readonly environment: BrowserRuntimeEnvironment;
}

const DEFAULT_GRAPHQL_API = "/graphql";
const TERMINAL_WEBSOCKET_PATH = "/ws/terminal";
const MAX_ACTIVE_SUBSCRIPTIONS = 256;

function invalid(field: string, expectation: string): never {
  throw new Error(
    `Invalid Studio runtime configuration: ${field} ${expectation}`,
  );
}

function validateHttpEndpoint(field: string, value: string): string {
  if (value !== value.trim() || value.length === 0) {
    return invalid(field, "must not be empty or contain surrounding whitespace");
  }
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    // Report the same stable contract error for every invalid URL shape.
  }
  return invalid(field, "must be a relative path or an HTTP(S) URL");
}

function subscriptionEndpoint(endpoint: string): string {
  return `${endpoint.replace(/\/$/, "")}/subscribe`;
}

function websocketEndpoint(graphQlApi: string): string {
  if (graphQlApi.startsWith("/") && !graphQlApi.startsWith("//")) {
    return TERMINAL_WEBSOCKET_PATH;
  }
  const url = new URL(graphQlApi);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}${TERMINAL_WEBSOCKET_PATH}`;
}

function validSubscriptionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

async function readSubscription(
  response: Response,
  onEvent: (response: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Rust GraphQL development adapter returned no subscription body.");
  const decoder = new TextDecoder();
  let buffered = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    let boundary = buffered.indexOf("\n\n");
    while (boundary >= 0) {
      const event = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      const frame = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (frame) onEvent(frame);
      boundary = buffered.indexOf("\n\n");
    }
    if (done) return;
  }
}

function browserGraphQlProxy(endpoint: string): GraphQlTransportProxy {
  const subscriptions = new Map<string, AbortController>();
  return {
    graphql_execute: async (requestJson) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestJson,
      });
      if (!response.ok) {
        throw new Error(`Rust GraphQL development adapter returned HTTP ${response.status}.`);
      }
      return response.text();
    },
    graphql_subscribe: async (subscriptionId, requestJson, onEvent) => {
      if (!validSubscriptionId(subscriptionId)) {
        throw new Error("The subscription id must use 1-128 ASCII letters, digits, hyphens, or underscores.");
      }
      if (subscriptions.has(subscriptionId)) {
        throw new Error(`The subscription id is already active: ${subscriptionId}`);
      }
      if (subscriptions.size >= MAX_ACTIVE_SUBSCRIPTIONS) {
        throw new Error("The browser has too many active GraphQL subscriptions.");
      }
      const controller = new AbortController();
      subscriptions.set(subscriptionId, controller);
      try {
        const response = await fetch(subscriptionEndpoint(endpoint), {
          method: "POST",
          headers: {
            accept: "text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify({ subscriptionId, request: requestJson }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Rust GraphQL development adapter returned HTTP ${response.status}.`);
        }
        void readSubscription(response, onEvent, controller.signal)
          .catch(() => {
            if (!controller.signal.aborted) onEvent('{"type":"complete"}');
          })
          .finally(() => {
            if (subscriptions.get(subscriptionId) === controller) {
              subscriptions.delete(subscriptionId);
            }
          });
        return '{"type":"accepted"}';
      } catch (error) {
        if (subscriptions.get(subscriptionId) === controller) {
          subscriptions.delete(subscriptionId);
        }
        throw error;
      }
    },
    graphql_unsubscribe: async (subscriptionId) => {
      const controller = subscriptions.get(subscriptionId);
      if (!controller) return false;
      subscriptions.delete(subscriptionId);
      controller.abort();
      return true;
    },
  };
}

/** Browser implementation of the shared Studio runtime boundary. */
export function createBrowserRuntime({
  environment,
}: BrowserRuntimeOptions): StudioRuntime {
  const graphQlApi = validateHttpEndpoint(
    "graphQlApi",
    environment.VITE_GRAPHQL_API || DEFAULT_GRAPHQL_API,
  );
  const terminalWebSocket = websocketEndpoint(graphQlApi);
  const startup: RuntimeStartupConfiguration = Object.freeze({
    serviceHealth: Object.freeze({
      state: "ready",
      service: "rust-graphql-adapter",
      message: null,
      logPointer: null,
    }),
    initialNotices: Object.freeze([]),
  });
  const graphQlProxy = browserGraphQlProxy(graphQlApi);
  const readWorkTracker: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.graphQl((document, variables) => executeFoundationOperation(
      document,
      variables,
      () => graphQlProxy,
    ));

  return Object.freeze({
    platform: "browser" as const,
    capabilities: Object.freeze({
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: false,
      nativeTerminal: false,
      nativeFolderPicker: false,
    }),
    readWorkTracker,
    // Browser development uses the same owned GraphQL operations through the
    // Rust development adapter. It has no REST fallback.
    writeWorkTracker: readWorkTracker,
    readSettings: readWorkTracker,
    writeSettings: readWorkTracker,
    statusStream: () => () => graphQlProxy,
    terminalWebSocketUrl: () => terminalWebSocket,
    // Browser development has no desktop protocol, so the Rust development
    // adapter exposes the same registered, read-only document assets over HTTP.
    documentUrl: (documentId: string, relPath: string) =>
      `${graphQlApi.replace(/\/graphql\/?$/, "")}/documents/${encodeURIComponent(documentId)}/${
        encodeDocumentPath(relPath)
      }`,
    pickFolder: async () => null,
    retryServices: async () => {
      throw new Error("Service recovery is available only in desktop Studio");
    },
    startup: () => startup,
    subscribeServiceHealth: (listener: ServiceHealthListener) => {
      listener(startup.serviceHealth);
      return () => {};
    },
    subscribeUserNotices: () => () => {},
  });
}
