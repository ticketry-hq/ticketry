import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchAgentAction } from "../app/shell/ticket-workspace/selected-ticket/details/LaunchAgentAction";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { Terminal, useTerminalStore } from "../features/agents/terminal";
import { useClientStore } from "../state/clientStore";
import {
  installGraphQlViewerLeases,
  type RecordedGraphQlOperation,
} from "./desktopGraphQlRuntime";
import { documentOperationName } from "../graphql-foundation/typedDocument";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  desktopRuntime: true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => tauri.desktopRuntime,
}));

vi.mock("../features/agents/terminal/refresh", () => ({
  refreshTerminalHoldings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../features/agents/terminal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/terminal")>()),
  launchFailureMessage: (error: unknown) => String(error),
}));

describe("Rust launch-policy acceptance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tauri.desktopRuntime = true;
    tauri.invoke.mockResolvedValue({
      target_id: "task-1",
      agent: "codex",
      agent_run_id: "run-1",
    });
    useAgentStatusStore.setState({ projectId: "project-1", runs: {} });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useClientStore.setState({ workspaces: {}, activeByTask: {} });
  });

  it("[overhaul-231] selects the Run agent terminal early but waits to attach until launch returns", async () => {
    let acknowledge!: (value: unknown) => void;
    tauri.invoke.mockImplementation(() => new Promise((resolve) => {
      acknowledge = resolve;
    }));
    render(
      <LaunchAgentAction
        issueId="task-1"
        projectId="project-1"
        moduleId="module-1"
      />,
    );

    const button = screen.getByRole("button", { name: "Run agent" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));

    act(() => {
      useAgentStatusStore.getState().upsertRun({
        agent_run_id: "run-early",
        project_id: "project-1",
        task_id: "task-1",
        module_id: "module-1",
        agent: "codex",
        scope: "task",
        state: "starting",
        effective_state: "starting",
        started_at: "2026-09-02T09:00:00Z",
        updated_at: "2026-09-02T09:00:00Z",
      });
    });

    await waitFor(() => {
      const sessionId = useTerminalStore.getState().sessionByRun["run-early"];
      expect(sessionId).toBeTruthy();
      expect(
        useTerminalStore.getState().sessions[sessionId!]
          ?.viewerAttachmentDeferred,
      ).toBe(true);
      expect(useClientStore.getState().activeByTask["task-1"]).toBe(sessionId);
      expect(useClientStore.getState().workspaces["task-1"]?.active)
        .toBe("terminal");
    });
    expect(button).toHaveAttribute("aria-busy", "true");

    acknowledge({ agent_run_id: "run-early" });
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "false"));
    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(1);
    const sessionId = useTerminalStore.getState().sessionByRun["run-early"];
    expect(
      useTerminalStore.getState().sessions[sessionId]
        ?.viewerAttachmentDeferred,
    ).toBe(false);
  });

  it("does not mount a renderer for a launch whose runtime is still pending", () => {
    useTerminalStore.setState({
      sessions: {
        "pending-session": {
          sessionId: "pending-session",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "connecting",
          transport: "connecting",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-pending",
          viewerAttachmentDeferred: true,
        },
      },
      sessionByRun: { "run-pending": "pending-session" },
    });

    render(<Terminal sessionId="pending-session" />);

    expect(screen.getByTestId("terminal-viewer-pending")).toBeInTheDocument();
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "viewer_attach",
      expect.anything(),
    );
  });

  it("[overhaul-81] routes the desktop launch action through Rust policy", async () => {
    const recorded = installGraphQlViewerLeases();
    render(
      <LaunchAgentAction
        issueId="task-1"
        projectId={null}
        moduleId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run agent" }));

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "desktop_launch_default_coding_agent",
        { issueId: "task-1" },
      );
    });
    expect(recorded).toHaveLength(0);
    await waitFor(() => {
      expect(
        useClientStore
          .getState()
          .toasts.some((toast) => toast.message === "Agent run started."),
      ).toBe(true);
    });
  });

  it("[overhaul-81b] launches a browser run over the GraphQL terminal seam without overriding launch authority", async () => {
    tauri.desktopRuntime = false;
    let createVariables: Record<string, unknown> | null = null;
    const recorded = installGraphQlViewerLeases(async (document, variables) => {
      if (documentOperationName(document) === "CreateTerminalSession") {
        createVariables = variables as Record<string, unknown>;
        return {
          terminal_session: {
            scope: "task",
            agent_run_id: "run-browser",
            module_id: "module-1",
            doc_rel_path: null,
            created_at: "2026-08-27T00:00:00Z",
            agent_run: null,
          },
        } as never;
      }
      return {} as never;
    });
    render(
      <LaunchAgentAction
        issueId="11111111-1111-4111-8111-111111111111"
        projectId="project-1"
        moduleId="module-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run agent" }));

    await waitFor(() => {
      expect(createVariables).not.toBeNull();
    });
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(createVariables).toMatchObject({
      projectId: "project-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      moduleId: "module-1",
      targetId: "11111111-1111-4111-8111-111111111111",
      kind: "task",
      workingDirectoryIdentity: "task:11111111111141118111111111111111",
    });
    // A default interactive launch carries identities only: the backend's
    // launch authority resolves provider, model, reasoning, and prompt.
    for (const forbidden of [
      "provider",
      "model",
      "reasoning",
      "prompt",
      "policyReference",
    ]) {
      expect(createVariables).not.toHaveProperty(forbidden);
    }
    const launches = recorded.filter(
      (op: RecordedGraphQlOperation) =>
        op.operationName !== "CreateTerminalSession",
    );
    expect(launches).toHaveLength(0);
    await waitFor(() => {
      expect(
        useClientStore
          .getState()
          .toasts.some((toast) => toast.message === "Agent run started."),
      ).toBe(true);
    });
  });

  it("[overhaul-81c] refuses to double-launch while a launch is in flight", async () => {
    tauri.desktopRuntime = true;
    let pending!: Promise<unknown>;
    tauri.invoke.mockImplementation(() => {
      pending = new Promise(() => {});
      return pending;
    });
    render(
      <LaunchAgentAction
        issueId="task-1"
        projectId="project-1"
        moduleId="module-1"
      />,
    );

    const button = screen.getByRole("button", { name: "Run agent" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(button);

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledTimes(1);
    });
  });

  it("[overhaul-81a] authorizes that launch command in the main desktop window", async () => {
    const tauriRoot = resolve(process.cwd(), "src-tauri");
    const [build, capability] = await Promise.all([
      readFile(resolve(tauriRoot, "build.rs"), "utf8"),
      readFile(resolve(tauriRoot, "capabilities/studio-main.json"), "utf8"),
    ]);

    expect(build).toContain('"desktop_launch_default_coding_agent"');
    expect(JSON.parse(capability).permissions).toContain(
      "allow-desktop-launch-default-coding-agent",
    );
  });
});
