import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { presentTerminalRuns } from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

const terminalApi = vi.hoisted(() => ({
  resumeTerminal: vi.fn(),
}));

const documentRegistry = vi.hoisted(() => ({
  listTaskDocuments: vi.fn(),
  listScratchDocuments: vi.fn(),
}));

vi.mock("../features/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/documents")>()),
  ...documentRegistry,
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

// Terminal session reads moved to the Rust Terminal Session graph, so the seam
// a test controls is the read transport, not a host API module.
const terminalReads = vi.hoisted(() => {
  const resumable = vi.fn();
  return {
    readTaskTerminalSessions: vi.fn(),
    readScratchTerminalSessions: vi.fn(),
    readTaskResumableTerminalSessions: resumable,
    readScratchResumableTerminalSessions: resumable,
  };
});

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket, active }: { bucket: string; active: boolean }) => (
      <div data-testid="selected-ticket-terminal" data-active={String(active)}>{bucket}</div>
    ),
  }),
);

function session(
  sessionId: string,
  taskId: string,
  agentRunId: string,
  status: SessionMeta["status"] = "ready",
): SessionMeta {
  return {
    sessionId,
    taskId,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status,
    transport: status === "ready" ? "ready" : "closed",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId,
  };
}

function run(
  agentRunId: string,
  taskId: string,
  state: "working" | "exited" | "lost" = "working",
  launchState: string | null = null,
) {
  return {
    agent_run_id: agentRunId,
    task_id: taskId,
    module_id: "module-1",
    // An agent run names its provider. The tab label reads it from the record;
    // nothing substitutes one when it is absent (#665).
    agent: "codex",
    scope: "task" as const,
    state,
    launch_state: launchState,
    launch_model: null,
    started_at: "2026-08-07T12:00:00Z",
    updated_at: "2026-08-07T12:00:00Z",
  };
}

describe("overhaul acceptance — terminals", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime(terminalSessionReadExecutor(terminalReads));
    localStorage.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "story-1",
      focusedPane: "tasks",
      sidebarVisible: true,
      storySearchQuery: "",
      collapsedStateIds: new Set(["todo"]),
      expandedIdsByModule: {},
      workspaces: {},
      activeByTask: {},
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    documentRegistry.listTaskDocuments.mockResolvedValue([]);
    documentRegistry.listScratchDocuments.mockResolvedValue([]);
    terminalReads.readTaskTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
  });

  it("[overhaul-35] labels task-bound terminal tabs with their captured launch state", async () => {
    // A live spawn and a restored attach both read the launch state their own
    // durable run recorded — never the ticket identifier the workspace already
    // shows, and never the Story's current state.
    useTerminalStore.setState({
      sessions: { "session-live": session("session-live", "story-1", "run-live") },
      sessionByRun: { "run-live": "session-live" },
    });
    useAgentStatusStore.setState({
      runs: {
        "run-live": run("run-live", "story-1", "working", "Grill"),
        "run-restored": run("run-restored", "story-1", "working", "Spec"),
      },
    });
    act(() => {
      useTerminalStore.getState().attachRun("run-restored");
    });
    const restored = Object.values(useTerminalStore.getState().sessions).find(
      (meta) => meta.agentRunId === "run-restored",
    );
    expect(restored?.taskId).toBe("story-1");

    render(
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Grill codex terminal" }))
        .toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Spec codex terminal" }))
      .toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close Grill codex terminal" }),
    ).toBeInTheDocument();
    // The strip never repeats the ticket the workspace is already showing.
    expect(screen.getByTestId("workspace-tabs")).not.toHaveTextContent("T-350");

    // Identity, persistence, and run ownership stay on the opaque identifiers.
    expect(useTerminalStore.getState().sessionByRun["run-live"]).toBe("session-live");

    // Scratch runs have no workflow state and keep their lowercase launch
    // modes; a run with no recorded launch state falls back to its provider.
    const scratch = {
      key: "scratch",
      agent: "codex",
      launchState: null,
      launchModel: null,
      isPlanning: true,
      isInstant: false,
      live: true,
    };
    expect(presentTerminalRuns([scratch])[0].label).toBe("plan");
    expect(
      presentTerminalRuns([{ ...scratch, isPlanning: false, isInstant: true }])[0]
        .label,
    ).toBe("instant");
    const unrecorded = presentTerminalRuns([{ ...scratch, isPlanning: false }])[0];
    expect(unrecorded.label).toBe("codex");
    expect(unrecorded.accessibleName).toBe("codex terminal");
  });

  it("[overhaul-49] restores a terminal directly when its run projection arrives later", async () => {
    render(
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
    );

    expect(useTerminalStore.getState().sessions).toEqual({});
    expect(terminalReads.readTaskTerminalSessions).not.toHaveBeenCalled();

    act(() => {
      useAgentStatusStore.setState({
        runs: { "run-late": run("run-late", "story-1") },
      });
    });

    await waitFor(() => {
      expect(Object.values(useTerminalStore.getState().sessions)).toContainEqual(
        expect.objectContaining({ agentRunId: "run-late" }),
      );
    });
    // Its run recorded no launch state, so the tab uses the provider Studio
    // does know about instead of rendering a colour-only control.
    const tab = screen.getByRole("tab", { name: "codex terminal" });
    expect(tab).toBeInTheDocument();
    expect(tab).toHaveTextContent("codex");
    expect(tab).toHaveClass("text-provider-codex");
    expect(terminalReads.readTaskTerminalSessions).not.toHaveBeenCalled();
  });

  it("[overhaul-111] gives dormant terminal chips the same launch identity as the tab for the same run", async () => {
    // A resumable conversation and a terminated one are the same kind of thing
    // the strip is showing, so they read the same way (#695).
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([
      {
        agent_run_id: "run-resumable",
        agent: "codex",
        status: "terminated",
        started_at: "2026-08-07T11:00:00Z",
        launch_state: "Grill",
        launch_model: "gpt-5",
        scope: "task",
        provider_session_id: "sess-1",
        resumed_from: null,
      },
      {
        // A scratch Instant run records no launch state by design, and this one
        // ended long enough ago that no run record survives in the status
        // store — its own scope is the only thing left to name it (#708).
        agent_run_id: "run-aged-scratch",
        agent: "codex",
        status: "terminated",
        started_at: "2026-06-01T09:00:00Z",
        launch_state: null,
        launch_model: null,
        scope: "instant",
        provider_session_id: "sess-2",
        resumed_from: null,
      },
    ]);
    useTerminalStore.setState({
      sessions: { "session-live": session("session-live", "story-1", "run-live") },
      sessionByRun: { "run-live": "session-live" },
    });
    useAgentStatusStore.setState({
      runs: {
        // The live tab this workspace is looking at…
        "run-live": run("run-live", "story-1", "working", "Grill"),
        // …and an ended run of the same phase, kept as history.
        "run-ended": run("run-ended", "story-1", "exited", "Grill"),
        // A run that recorded no phase shows none, rather than a guess.
        "run-unrecorded": run("run-unrecorded", "story-1", "exited", null),
      },
    });

    render(
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
    );

    const tab = await screen.findByRole("tab", { name: "Grill codex terminal" });
    const endedChip = await screen.findByLabelText(
      "Terminated Grill codex terminal",
    );
    // Chip and tab agree word for word on the run's identity, and neither
    // repeats the ticket the workspace already shows.
    expect(endedChip).toHaveTextContent("Grill");
    expect(endedChip).not.toHaveTextContent("T-350");
    expect(endedChip).toHaveAttribute("title", tab.getAttribute("title")!);
    // The tab is live so it wears its provider colour; the ended chip does not.
    expect(tab).toHaveClass("text-provider-codex");
    expect(endedChip).toHaveClass("text-provider-ended");
    expect(endedChip).not.toHaveClass("text-provider-codex");

    // A resume chip names its phase too, and resuming stays addressed by run.
    const resumeChip = await screen.findByRole("button", {
      name: "Resume Grill codex terminal",
    });
    expect(resumeChip).toHaveTextContent("Grill");
    expect(resumeChip).toHaveAttribute(
      "title",
      "codex · gpt-5 · started in Grill",
    );

    // The aged-out scratch run recorded no launch state and has no run record
    // left in the status store, so the listing's own scope is what keeps its
    // lowercase mode word instead of leaving a wordless chip (#708).
    const scratchChip = screen.getByRole("button", {
      name: /^Resume instant codex terminal/,
    });
    expect(scratchChip).toHaveTextContent("instant");
    expect(scratchChip).toHaveAttribute("title", "codex");

    // An unrecorded phase uses the provider rather than borrowing the Story's
    // current state or leaving a nameless control.
    const providerChip = screen.getByLabelText("Terminated codex terminal");
    expect(providerChip).toHaveTextContent("codex");
    expect(providerChip).toHaveAttribute("title", "codex");
  });

  it("[overhaul-112] rebuilds launch labels, provider styling and ordinals from the authoritative records after a reload", async () => {
    // A reload starts with no client-side session state. ProjectRunStatus must
    // reproduce the tabs without an AgentTerminalSessions discovery read.
    render(
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
    );
    act(() => {
      useAgentStatusStore.setState({
        runs: {
          "run-first": {
            ...run("run-first", "story-1", "working", "Grill"),
            launch_model: "gpt-5",
            started_at: "2026-08-07T12:00:00Z",
          },
          "run-second": {
            ...run("run-second", "story-1", "working", "Grill"),
            started_at: "2026-08-07T12:05:00Z",
          },
          "run-gone": {
            ...run("run-gone", "story-1", "exited", "Spec"),
            started_at: "2026-08-07T12:10:00Z",
          },
        },
      });
    });

    // Captured state and model come back on the tab, ordinals included: the
    // two live Grill runs still collide, in the launch order the records give.
    const first = await screen.findByRole("tab", {
      name: "Grill 1 codex terminal",
    });
    expect(first).toHaveAttribute("title", "codex · gpt-5 · started in Grill");
    expect(first).toHaveClass("bg-pane-bg", "text-provider-codex");
    expect(screen.getByRole("tab", { name: "Grill 2 codex terminal" }))
      .toHaveClass("text-provider-codex");
    // The ended run comes back as history rather than a tab, and its captured
    // phase and neutral liveness treatment are reconstructed too.
    const ended = screen.getByLabelText("Terminated Spec codex terminal");
    expect(ended).toHaveTextContent("Spec");
    expect(ended).toHaveClass("text-provider-ended");
    expect(terminalReads.readTaskTerminalSessions).not.toHaveBeenCalled();
  });
});
