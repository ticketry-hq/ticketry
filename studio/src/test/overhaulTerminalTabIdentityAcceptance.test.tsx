import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

// The tab strip's job in a task workspace is to say *who* is working and *what
// phase* each conversation belongs to (#694). The ticket identifier and title
// are already everywhere around the strip, so they are gone from the tab; the
// provider is carried by colour rather than by words; and colour at all means
// the run is still live.

const terminalApi = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  resumeTerminal: vi.fn(),
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
    SelectedTicketTerminal: ({ bucket }: { bucket: string }) => (
      <div data-testid="selected-ticket-terminal">{bucket}</div>
    ),
  }),
);

function session(
  sessionId: string,
  agentRunId: string,
  agent: SessionMeta["agent"] = "claude",
): SessionMeta {
  return {
    sessionId,
    taskId: "story-1",
    projectId: "project-1",
    moduleId: "module-1",
    agent,
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId,
  };
}

function run({
  agentRunId,
  agent = "claude",
  state = "working",
  launchState = null,
  launchModel = null,
  startedAt = "2026-08-07T12:00:00Z",
}: {
  agentRunId: string;
  agent?: string;
  state?: "working" | "exited" | "lost" | "error";
  launchState?: string | null;
  launchModel?: string | null;
  startedAt?: string;
}) {
  return {
    agent_run_id: agentRunId,
    task_id: "story-1",
    module_id: "module-1",
    agent,
    scope: "task" as const,
    state,
    launch_state: launchState,
    launch_model: launchModel,
    started_at: startedAt,
    updated_at: startedAt,
  };
}

function workspace() {
  return (
      <SelectedTicketContent
        bucket="story-1"
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Issue details</div>}
      />
  );
}

describe("overhaul acceptance — terminal tab identity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime(terminalSessionReadExecutor(terminalReads));
    localStorage.clear();
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
    terminalApi.getDocuments.mockResolvedValue({ documents: [] });
    terminalReads.readTaskTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
  });

  it("[overhaul-108] names a terminal tab by the workflow state its run launched in", async () => {
    useTerminalStore.setState({
      sessions: { "session-1": session("session-1", "run-1") },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({
      runs: {
        "run-1": run({
          agentRunId: "run-1",
          launchState: "Grill",
          launchModel: "opus-5",
        }),
      },
    });

    render(workspace());

    const tab = await screen.findByRole("tab", { name: "Grill claude terminal" });
    // The tab shows the phase alone: no ticket identifier, no ticket title, no
    // provider slug — colour and hover carry the rest.
    expect(tab).toHaveTextContent("Grill");
    expect(tab).not.toHaveTextContent("T-350");
    expect(tab).not.toHaveTextContent("claude");
    expect(tab).toHaveAttribute("title", "claude · opus-5 · started in Grill");

    // The snapshot is a historical fact: moving the Story on does not rename
    // the conversation that began in Grill, and a later run reads its own state.
    act(() => {
      useTerminalStore.setState({
        sessions: {
          "session-1": session("session-1", "run-1"),
          "session-2": session("session-2", "run-2"),
        },
        sessionByRun: { "run-1": "session-1", "run-2": "session-2" },
      });
      useAgentStatusStore.setState({
        runs: {
          "run-1": run({
            agentRunId: "run-1",
            launchState: "Grill",
            launchModel: "opus-5",
          }),
          "run-2": run({
            agentRunId: "run-2",
            launchState: "Spec",
            startedAt: "2026-08-07T13:00:00Z",
          }),
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Spec claude terminal" }))
        .toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Grill claude terminal" }))
      .toBeInTheDocument();
    // Hover states only what was recorded — an unrecorded model is omitted
    // rather than filled in.
    expect(screen.getByRole("tab", { name: "Spec claude terminal" }))
      .toHaveAttribute("title", "claude · started in Spec");
  });

  it("[overhaul-109] colours a terminal tab by provider while it is live and greys it once it ends", async () => {
    useTerminalStore.setState({
      sessions: {
        "session-claude": session("session-claude", "run-claude", "claude"),
        "session-codex": session("session-codex", "run-codex", "codex"),
        "session-gemini": session("session-gemini", "run-gemini", "gemini"),
        "session-agy": session("session-agy", "run-agy", "agy"),
      },
      sessionByRun: {
        "run-claude": "session-claude",
        "run-codex": "session-codex",
        "run-gemini": "session-gemini",
        "run-agy": "session-agy",
      },
    });
    useAgentStatusStore.setState({
      runs: {
        "run-claude": run({
          agentRunId: "run-claude",
          agent: "claude",
          launchState: "Grill",
          startedAt: "2026-08-07T12:00:00Z",
        }),
        "run-codex": run({
          agentRunId: "run-codex",
          agent: "codex",
          launchState: "Spec",
          startedAt: "2026-08-07T12:01:00Z",
        }),
        "run-gemini": run({
          agentRunId: "run-gemini",
          agent: "gemini",
          launchState: "Implement",
          startedAt: "2026-08-07T12:02:00Z",
        }),
        "run-agy": run({
          agentRunId: "run-agy",
          agent: "agy",
          launchState: "Review",
          startedAt: "2026-08-07T12:03:00Z",
        }),
      },
    });

    render(workspace());

    const claudeTab = await screen.findByRole("tab", {
      name: "Grill claude terminal",
    });
    const codexTab = screen.getByRole("tab", { name: "Spec codex terminal" });
    const geminiTab = screen.getByRole("tab", {
      name: "Implement gemini terminal",
    });
    const agyTab = screen.getByRole("tab", { name: "Review agy terminal" });

    // Unselected live tabs sit on the pane ground and read in their provider's
    // own colour.
    for (const [tab, provider] of [
      [claudeTab, "claude"],
      [codexTab, "codex"],
      [geminiTab, "gemini"],
      [agyTab, "agy"],
    ] as const) {
      expect(tab).toHaveClass("bg-pane-bg", `text-provider-${provider}`);
      expect(tab).toHaveAttribute("aria-selected", "false");
    }

    // Selecting inverts exactly those two colours, and only for the tab chosen.
    fireEvent.click(codexTab);
    await waitFor(() => {
      expect(codexTab).toHaveAttribute("aria-selected", "true");
    });
    expect(codexTab).toHaveClass("bg-provider-codex", "text-provider-ink");
    expect(claudeTab).toHaveClass("bg-pane-bg", "text-provider-claude");

    fireEvent.click(claudeTab);
    await waitFor(() => {
      expect(claudeTab).toHaveClass("bg-provider-claude", "text-provider-ink");
    });
    expect(codexTab).toHaveClass("bg-pane-bg", "text-provider-codex");

    // Ending a run drops the hue entirely: colour means the run is still going.
    // Its lifecycle badge remains its own, separately coloured axis.
    for (const [runId, agent, state] of [
      ["run-codex", "codex", "exited"],
      ["run-gemini", "gemini", "lost"],
      ["run-agy", "agy", "error"],
    ] as const) {
      act(() => {
        useAgentStatusStore.setState({
          runs: {
            ...useAgentStatusStore.getState().runs,
            [runId]: {
              ...useAgentStatusStore.getState().runs[runId],
              state,
              updated_at: "2026-08-07T14:00:00Z",
            },
          },
        });
      });
      await waitFor(() => {
        const tab = screen.getByRole("tab", {
          name: new RegExp(`${agent} terminal$`),
        });
        expect(tab).toHaveClass("text-provider-ended");
        expect(tab).not.toHaveClass(`text-provider-${agent}`);
      });
    }
    // The selected live tab keeps its provider fill through all of that, and
    // its lifecycle badge is still the badge's own palette.
    expect(claudeTab).toHaveClass("bg-provider-claude", "text-provider-ink");
    expect(
      within(claudeTab).getByLabelText("Agent is actively working"),
    ).toBeInTheDocument();
  });

  it("[overhaul-110] gives duplicate live provider/state pairs launch-order ordinals only while they collide", async () => {
    useTerminalStore.setState({
      sessions: {
        "session-first": session("session-first", "run-first"),
        "session-second": session("session-second", "run-second"),
      },
      sessionByRun: {
        "run-first": "session-first",
        "run-second": "session-second",
      },
    });
    useAgentStatusStore.setState({
      runs: {
        "run-first": run({
          agentRunId: "run-first",
          launchState: "Grill",
          startedAt: "2026-08-07T12:00:00Z",
        }),
        "run-second": run({
          agentRunId: "run-second",
          launchState: "Grill",
          startedAt: "2026-08-07T12:05:00Z",
        }),
      },
    });

    render(workspace());

    // Ordinals follow launch order, not tab creation order.
    expect(
      await screen.findByRole("tab", { name: "Grill 1 claude terminal" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Grill 2 claude terminal" }))
      .toBeInTheDocument();

    // An ended run is not a visible collision: once it stops being live, the
    // surviving tab loses the numeral it no longer needs. Its tab stays in the
    // strip though, so assistive text — which has no colour to read liveness
    // from — says which of the two already ended (#709).
    act(() => {
      useAgentStatusStore.setState({
        runs: {
          ...useAgentStatusStore.getState().runs,
          "run-second": {
            ...useAgentStatusStore.getState().runs["run-second"],
            state: "exited",
            updated_at: "2026-08-07T14:00:00Z",
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Grill claude terminal" }))
        .toBeInTheDocument();
    });
    expect(
      screen.getByRole("tab", { name: "Grill claude terminal (ended)" }),
    ).toBeInTheDocument();
    // Both tabs still read "Grill" on screen — only the assistive name grew.
    expect(
      screen.getAllByRole("tab").filter((tab) => tab.textContent?.includes("Grill")),
    ).toHaveLength(2);
    expect(screen.queryByRole("tab", { name: "Grill 1 claude terminal" }))
      .not.toBeInTheDocument();
    // The close control follows the name it closes, so it is addressable too.
    expect(
      screen.getByRole("button", { name: "Close Grill claude terminal (ended)" }),
    ).toBeInTheDocument();
  });

  it("[overhaul-114] gives runs with no recorded launch state visible provider labels", async () => {
    useTerminalStore.setState({
      sessions: {
        "session-first": session("session-first", "run-first"),
        "session-second": session("session-second", "run-second"),
      },
      sessionByRun: {
        "run-first": "session-first",
        "run-second": "session-second",
      },
    });
    // Runs from before the launch-metadata migration record no launch state, so
    // both tabs fall back to the provider name and receive visible ordinals.
    useAgentStatusStore.setState({
      runs: {
        "run-first": run({
          agentRunId: "run-first",
          startedAt: "2026-08-07T12:00:00Z",
        }),
        "run-second": run({
          agentRunId: "run-second",
          startedAt: "2026-08-07T12:05:00Z",
        }),
      },
    });

    render(workspace());

    expect(
      await screen.findByRole("tab", { name: "claude 1 terminal" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "claude 2 terminal" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "claude terminal" }))
      .not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "claude 1 terminal" }),
    ).toHaveTextContent("claude 1");
  });
});
