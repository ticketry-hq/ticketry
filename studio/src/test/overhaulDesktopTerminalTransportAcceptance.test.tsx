import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeStudioRuntime, type StudioRuntime } from "../runtime";
import { queryClient } from "../shared/query/queryClient";
import {
  createTerminalSession,
  resumeTerminalSession,
  terminateTerminalSession,
} from "../features/agents/terminal/internal/mutationTransport";
import { desktopViewerLease } from "../features/agents/terminal/internal/viewerLease";
import {
  createModuleShell,
  listModuleShells,
} from "../features/terminal-panel/api/moduleShellApi";
import { runWorkItemNow } from "../features/work-items/internal/runNowTransport";
import { RunStatusStreamDocument } from "../features/agents/status/generated/statusStream";
import { readStatusFact } from "../features/agents/status/stream/statusFacts";

const runtime = vi.hoisted(() => ({ desktop: true }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => runtime.desktop,
  Channel: class {},
  invoke: vi.fn(),
}));

function desktopRuntime(
  writeWorkTracker: StudioRuntime["writeWorkTracker"],
): StudioRuntime {
  return {
    platform: "desktop",
    capabilities: {
      statusFeed: true,
      websocketTerminal: false,
      nativeLifecycle: true,
      serviceSupervision: true,
      nativeTerminal: true,
      nativeFolderPicker: true,
    },
    readWorkTracker: writeWorkTracker,
    writeWorkTracker,
    readSettings: writeWorkTracker,
    writeSettings: writeWorkTracker,
    statusStream: () => null,
    documentUrl: (id, path) => `ticketrydoc://localhost/${id}/${path}`,
    pickFolder: async () => null,
    retryServices: async () => {},
    startup: () => ({
      endpoints: {
        workTrackerApi: "/api/work-tracker",
        agentApi: "/api",
        statusApi: "/api",
      },
      values: { workTrackerApiKey: "" },
      serviceHealth: {
        state: "ready",
        service: "terminal-runtime",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
  };
}

describe("desktop terminal transport acceptance", () => {
  beforeEach(() => {
    runtime.desktop = true;
    vi.resetModules();
  });

  it("[overhaul-153] routes the desktop xterm fallback through Tauri viewer commands", async () => {
    const [{ tauriTerminalClient }, { terminalClientTransport }] = await Promise.all([
      import("../features/agents/terminal/internal/tauriTerminalClient"),
      import("../features/agents/terminal/internal/terminalClientRuntime"),
    ]);

    expect(terminalClientTransport).toBe(tauriTerminalClient);
  });

  it("[overhaul-154] uses one Rust GraphQL control plane for agent terminals, module shells, and viewer ownership", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const calls: Array<{ operationName: string; variables: Record<string, unknown> }> = [];
    let firstCreateAttempt = true;
    let firstRunNowAttempt = true;
    const execute = vi.fn(async (
      document: { operationName: string },
      variables: Record<string, unknown>,
    ) => {
      calls.push({ operationName: document.operationName, variables });
      if (document.operationName === "RunWorkTrackerWorkItemNow") {
        if (firstRunNowAttempt) {
          firstRunNowAttempt = false;
          throw new Error("TauRPC response interrupted");
        }
        return {
          run_now: {
            target_id: "task-1",
            code: "run_now_started",
            detail: "Run Now started.",
            remedy: null,
            committed_state: { id: "implement", name: "Implement" },
            run: {
              target_id: "task-1",
              agent: "codex",
              agent_run_id: "run-now",
            },
          },
        };
      }
      if (document.operationName === "CreateTerminalSession" && firstCreateAttempt) {
        firstCreateAttempt = false;
        throw new Error("TauRPC response interrupted");
      }
      if (document.operationName.endsWith("ViewerLease")) {
        return {
          viewer_lease: document.operationName === "DeleteViewerLease"
            ? null
            : {
                agent_run_id: "run-lease",
                viewer_id: "viewer-1",
                transport: "xterm",
                generation: "lease-generation",
                acquired_at: "2026-08-19T10:00:00Z",
                expires_at: "2026-08-19T10:00:30Z",
              },
        };
      }
      if (document.operationName === "ModuleShellSessions") {
        return {
          terminal_sessions: {
            sessions: [{
              agent_run_id: "run-shell",
              module_id: "module-1",
              scope: "shell",
              doc_rel_path: null,
              created_at: "2026-08-19T10:00:00Z",
              agent_run: { id: "run-shell", launch_state: null, launch_model: null },
            }],
          },
        };
      }
      return {
        terminal_session: {
          agent_run_id: document.operationName === "ResumeTerminalSession"
            ? "run-resumed"
            : document.operationName === "CreateModuleShell"
              ? "run-shell"
              : "run-created",
          module_id: "module-1",
          scope: document.operationName === "CreateModuleShell" ? "shell" : "task",
          doc_rel_path: null,
          created_at: "2026-08-19T10:00:00Z",
          agent_run: { id: "run-created" },
        },
      };
    });
    initializeStudioRuntime(
      desktopRuntime((routes) => routes.graphQl(execute as never)),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    await expect(runWorkItemNow("task-1")).resolves.toMatchObject({
      target_id: "task-1",
      committed_state: { id: "implement", name: "Implement" },
      run: { agent_run_id: "run-now" },
    });
    await createTerminalSession({
      agent: "codex",
      projectId: "project-1",
      moduleId: "module-1",
      taskId: "task-1",
      initialPrompt: "Fix the terminal",
      isPlanning: false,
      isInstant: false,
    });
    await createTerminalSession({
      agent: "codex",
      projectId: "project-1",
      moduleId: "module-1",
      taskId: "task-1",
      initialPrompt: "Fix the terminal",
      isPlanning: false,
      isInstant: false,
    });
    await resumeTerminalSession({
      projectId: "project-1",
      moduleId: "module-1",
      taskId: "task-1",
      source: {
        agent_run_id: "run-ended",
        agent: "codex",
        status: "completed",
        started_at: "2026-08-19T09:00:00Z",
        ended_at: "2026-08-19T09:30:00Z",
        launch_model: "gpt-5",
        provider_session_id: "conversation-1",
        resumed_from: null,
        scope: "task",
      },
    });
    await terminateTerminalSession("run-created");
    const lease = await desktopViewerLease.acquire("run-lease", "viewer-1", "xterm");
    await desktopViewerLease.renew("run-lease", "viewer-1", lease.generation);
    await desktopViewerLease.release("run-lease", "viewer-1", lease.generation);
    await expect(createModuleShell("module-1")).resolves.toBe("run-shell");
    await expect(listModuleShells("module-1")).resolves.toEqual([{
      agent_run_id: "run-shell",
      module_id: "module-1",
      created_at: "2026-08-19T10:00:00Z",
    }]);

    const creates = calls.filter((call) => call.operationName === "CreateTerminalSession");
    const runNowCalls = calls.filter(
      (call) => call.operationName === "RunWorkTrackerWorkItemNow",
    );
    expect(runNowCalls).toHaveLength(2);
    expect(runNowCalls[0].variables.requestIdentity)
      .toBe(runNowCalls[1].variables.requestIdentity);
    expect(creates[0].variables.clientRequestId).toBe(creates[1].variables.clientRequestId);
    expect(creates[2].variables.clientRequestId).not.toBe(creates[1].variables.clientRequestId);
    expect(calls.map((call) => call.operationName)).toEqual([
      "RunWorkTrackerWorkItemNow",
      "RunWorkTrackerWorkItemNow",
      "CreateTerminalSession",
      "CreateTerminalSession",
      "CreateTerminalSession",
      "ResumeTerminalSession",
      "UpdateTerminalSession",
      "CreateViewerLease",
      "UpdateViewerLease",
      "DeleteViewerLease",
      "CreateModuleShell",
      "ModuleShellSessions",
    ]);
    const shellCreate = calls.find((call) => call.operationName === "CreateModuleShell");
    expect(shellCreate?.variables).toEqual({
      clientRequestId: expect.any(String),
      moduleId: "module-1",
      columns: 80,
      rows: 24,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["terminal-sessions"],
      refetchType: "active",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[overhaul-155] consumes Rust output and effective-state projections on snapshot and live status", () => {
    expect(RunStatusStreamDocument.source).toContain("effective_state");
    expect(RunStatusStreamDocument.source).toContain("output_sequence");
    expect(RunStatusStreamDocument.source).toContain("last_output_at");

    const fact = readStatusFact({
      __typename: "RunStatusEvent",
      cursor: 14,
      event_id: "event-14",
      project_id: "project-1",
      event_kind: "agent_run.terminal_activity",
      payload_version: 1,
      subject_kind: "agent_run",
      subject_id: "run-shell",
      agent_run_id: "run-shell",
      automation_attempt_id: null,
      work_item_id: null,
      committed_at: "2026-08-19T10:01:00Z",
      payload: {
        type: "terminal_activity",
        at: "2026-08-19T10:01:00Z",
        run: {
          agent_run_id: "run-shell",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: null,
          scope: "shell",
          launch_state: null,
          launch_model: null,
          started_at: "2026-08-19T10:00:00Z",
          state: "working",
          effective_state: "stalled",
          updated_at: "2026-08-19T10:01:00Z",
          provider_session_id: null,
          output_sequence: 4,
          last_output_at: "2026-08-19T10:00:00Z",
        },
      },
    });

    expect(fact).toMatchObject({
      family: "agent_run_activity",
      run: {
        agent: null,
        scope: "shell",
        effective_state: "stalled",
        output_sequence: 4,
        last_output_at: "2026-08-19T10:00:00Z",
      },
    });
  });
});
