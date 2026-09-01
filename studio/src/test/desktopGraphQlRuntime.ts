import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import type { StudioRuntime, WorkTrackerGraphQlExecute } from "../runtime";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import type {
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../features/agents/types";
import { stubAppUpdatesRuntime } from "./appUpdatesRuntimeStub";

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
  (LEASE_OPERATIONS.has(documentOperationName(document))
    ? { viewer_lease: grantedLease(variables) }
    : {}) as never;

export interface TerminalSessionReadFixture {
  readTaskTerminalSessions(taskId: string): Promise<PersistedTerminalSession[]>;
  readScratchTerminalSessions(
    projectId: string,
    moduleId: string,
  ): Promise<PersistedTerminalSession[]>;
  readTaskResumableTerminalSessions(taskId: string): Promise<ResumableTerminalSession[]>;
  readScratchResumableTerminalSessions(
    projectId: string,
    moduleId: string,
  ): Promise<ResumableTerminalSession[]>;
}

function terminalSessionRow(
  session: PersistedTerminalSession,
  moduleId: string,
  scope: "task" | "plan",
) {
  return {
    __typename: "AgentTerminalSessions",
    agent_run_id: session.agent_run_id,
    module_id: moduleId,
    scope,
    doc_rel_path: session.doc_rel_path ?? null,
    created_at: session.created_at,
    agent_run: {
      __typename: "AgentRuns",
      id: session.agent_run_id,
      launch_state: session.launch_state ?? null,
      launch_model: session.launch_model ?? null,
    },
  };
}

/** Adapt legacy-shaped fixture data onto the Apollo operations under test. */
export function terminalSessionReadExecutor(
  fixture: TerminalSessionReadFixture,
): WorkTrackerGraphQlExecute {
  return async (document, variables) => {
    const operation = documentOperationName(document);
    const input = variables as Record<string, string>;
    if (operation === "LoadProviderCatalog") {
      const provider = {
        __typename: "WorktrackerProvider",
        id: "codex",
        slug: "codex",
        activated: true,
        supports_unattended: true,
      };
      return {
        provider_catalog: {
          __typename: "ProviderCatalog",
          configurable_providers: [provider],
          providers: [provider],
          agent_models: [],
          reasoning_levels: [],
          global_default: null,
        },
      } as never;
    }
    if (operation === "RefreshTaskDocumentRegistry") {
      return { refresh_task_document_registry: [] } as never;
    }
    if (operation === "RefreshScratchDocumentRegistry") {
      return { refresh_scratch_document_registry: [] } as never;
    }
    if (operation === "TaskDocumentRegistry" || operation === "ScratchDocumentRegistry") {
      return {
        document_registry: {
          __typename: "DesignDocumentsConnection",
          nodes: [],
        },
      } as never;
    }
    if (operation === "TaskTerminalSessions") {
      const sessions = await fixture.readTaskTerminalSessions(input.taskId);
      return {
        terminal_sessions: {
          __typename: "AgentTerminalSessionsConnection",
          sessions: sessions.map((session) => terminalSessionRow(
            session,
            input.moduleId ?? "module-1",
            "task",
          )),
        },
      } as never;
    }
    if (operation === "ScratchTerminalSessions") {
      const sessions = await fixture.readScratchTerminalSessions(
        input.projectId,
        input.moduleId,
      );
      return {
        terminal_sessions: {
          __typename: "AgentTerminalSessionsConnection",
          sessions: sessions.map((session) => terminalSessionRow(
            session,
            input.moduleId,
            "plan",
          )),
        },
      } as never;
    }
    if (operation === "TaskResumableTerminalSessions") {
      const sessions = await fixture.readTaskResumableTerminalSessions(input.taskId);
      return {
        resumable_sessions: sessions.map((session) => ({
          __typename: "AgentRuns",
          ...session,
          ended_at: session.ended_at ?? null,
          launch_state: session.launch_state ?? null,
          launch_model: session.launch_model ?? null,
        })),
      } as never;
    }
    if (operation === "ScratchResumableTerminalSessions") {
      const sessions = await fixture.readScratchResumableTerminalSessions(
        input.projectId,
        input.moduleId,
      );
      return {
        resumable_sessions: sessions.map((session) => ({
          __typename: "AgentRuns",
          ...session,
          ended_at: session.ended_at ?? null,
          launch_state: session.launch_state ?? null,
          launch_model: session.launch_model ?? null,
        })),
      } as never;
    }
    return grantsEveryLease(document, variables);
  };
}

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
      recorded.push({ operationName: documentOperationName(document), variables });
      return execute(document, variables);
    }) as WorkTrackerGraphQlExecute);
  const graphQlTransport: StudioRuntime["graphQlTransport"] = () => ({
    graphql_execute: async (requestJson) => {
      const request = JSON.parse(requestJson) as {
        operationName: string;
        variables: unknown;
      };
      recorded.push(request);
      const data = await execute(
        { operationName: request.operationName } as never,
        request.variables as never,
      );
      return JSON.stringify({ data });
    },
    graphql_subscribe: async () => '{"type":"accepted"}',
    graphql_unsubscribe: async () => true,
  });

  initializeStudioRuntime({
    platform: "desktop",
    graphQlTransport,
    capabilities: {
      statusFeed: true,
      nativeLifecycle: true,
      serviceSupervision: true,
      nativeTerminal: true,
      nativeFolderPicker: true,
      appUpdates: true,
    },
    appUpdates: stubAppUpdatesRuntime(),
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
        recorded.push({ operationName: documentOperationName(document), variables });
        return execute(document, variables);
      }) as WorkTrackerGraphQlExecute),
  });
  return recorded;
}
