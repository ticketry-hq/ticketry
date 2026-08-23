import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import type { StudioRuntime, WorkTrackerGraphQlExecute } from "../runtime";

/**
 * The runtime every terminal surface actually ships on.
 *
 * Terminal sessions, module shells, and viewer leases are served by the Rust
 * terminal lifecycle over the desktop's in-process GraphQL transport. The
 * `/api/terminals` routes that used to answer in browser development were
 * retired with the Python terminal authority, so a test that renders a native
 * viewer against the default browser runtime is not exercising a weaker
 * transport — it is exercising none at all.
 *
 * Installing this runtime is what puts those surfaces on their real transport,
 * and the returned log is what a test asserts against instead of a URL.
 */
export interface RecordedGraphQlOperation {
  readonly operationName: string;
  readonly variables: unknown;
}

const LEASE_OPERATIONS = new Set([
  "CreateViewerLease",
  "UpdateViewerLease",
  "DeleteViewerLease",
]);

/** A granted lease for the identity the caller asked about. */
function grantedLease(variables: unknown) {
  const asked = (variables ?? {}) as {
    agentRunId?: string;
    viewerId?: string;
    transport?: "native" | "xterm";
  };
  return {
    agent_run_id: asked.agentRunId ?? "run-1",
    viewer_id: asked.viewerId ?? "viewer-1",
    transport: asked.transport ?? "native",
    generation: asked.viewerId ?? "viewer-1",
    acquired_at: "2026-08-22T10:00:00Z",
    expires_at: "2026-08-22T10:00:30Z",
  };
}

/** Grants every lease and answers anything else with an empty payload. */
export const grantsEveryLease: WorkTrackerGraphQlExecute = async (
  document,
  variables,
) =>
  (LEASE_OPERATIONS.has(document.operationName)
    ? { viewer_lease: grantedLease(variables) }
    : {}) as never;

/**
 * Install the desktop GraphQL runtime and record what Studio asks it for.
 *
 * Pass `execute` to control the answers — to fail one operation, to hold one
 * open, or to return a specific payload. The returned array is appended to in
 * call order and stays live for the rest of the test.
 */
export function installDesktopGraphQlRuntime(
  execute: WorkTrackerGraphQlExecute = grantsEveryLease,
): RecordedGraphQlOperation[] {
  const recorded: RecordedGraphQlOperation[] = [];
  const route: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.graphQl(((document, variables) => {
      recorded.push({ operationName: document.operationName, variables });
      return execute(document, variables);
    }) as WorkTrackerGraphQlExecute);

  initializeStudioRuntime({
    platform: "desktop",
    capabilities: {
      statusFeed: true,
      nativeLifecycle: true,
      serviceSupervision: true,
      nativeTerminal: true,
      nativeFolderPicker: true,
    },
    readWorkTracker: route,
    writeWorkTracker: route,
    readSettings: route,
    writeSettings: route,
    statusStream: () => null,
    documentUrl: (documentId, relPath) =>
      `ticketrydoc://localhost/${documentId}/${relPath}`,
    pickFolder: async () => null,
    retryServices: async () => {},
    startup: () => ({
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
  });

  return recorded;
}

/**
 * Ownership on the Rust contract, everything else left alone.
 *
 * Some surfaces are mounted through the REST work-item fixture, which serves
 * the app's reads over `fetch`. Those tests still need viewer leases to reach
 * the Rust contract rather than a retired host route, so this swaps only the
 * writer and leaves the fixture's reads in place.
 */
export function installGraphQlViewerLeases(
  execute: WorkTrackerGraphQlExecute = grantsEveryLease,
): RecordedGraphQlOperation[] {
  const recorded: RecordedGraphQlOperation[] = [];
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({
    ...browser,
    writeWorkTracker: (routes) =>
      routes.graphQl(((document, variables) => {
        recorded.push({ operationName: document.operationName, variables });
        return execute(document, variables);
      }) as WorkTrackerGraphQlExecute),
  });
  return recorded;
}
