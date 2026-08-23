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

function browserGraphQlProxy(endpoint: string): GraphQlTransportProxy {
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
    graphql_subscribe: async () => {
      throw new Error("Browser development does not support GraphQL subscriptions.");
    },
    graphql_unsubscribe: async () => false,
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
  const startup: RuntimeStartupConfiguration = Object.freeze({
    serviceHealth: Object.freeze({
      state: "ready",
      service: "rust-graphql-adapter",
      message: null,
      logPointer: null,
    }),
    initialNotices: Object.freeze([]),
  });
  const readWorkTracker: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.graphQl((document, variables) => executeFoundationOperation(
      document,
      variables,
      () => browserGraphQlProxy(graphQlApi),
    ));

  return Object.freeze({
    platform: "browser" as const,
    capabilities: Object.freeze({
      // Browser development has no in-process GraphQL transport, and neither
      // the status WebSocket nor the terminal WebSocket it used to fall back
      // to still exists.
      statusFeed: false,
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
    statusStream: () => null,
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
