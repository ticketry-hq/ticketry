import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Terminal, useTerminalStore, useStoryEndedRuns } from "../features/agents/terminal";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn().mockResolvedValue(false) }));

const missing = {
  status: "checked", provider: "codex", code: null, message: null,
  searched_roots: ["/worktree/.agents/skills"],
  skills: ["structure-review", "interaction-design"].map((requested) => ({
    requested, status: "missing", installed_name: null, location: null, reason: null,
  })),
};
let report: unknown = missing;

beforeEach(() => {
  report = missing;
  installDesktopGraphQlRuntime(async (_document, variables) => ({
    agent_runs: { __typename: "AgentRunsConnection", nodes: [{
      __typename: "AgentRuns", id: (variables as { agentRunId: string }).agentRunId, stage_skill_availability: JSON.stringify(report),
    }] },
  }) as never);
  useAgentStatusStore.setState({ projectId: "project-1", runs: {
    "run-1": {
      agent_run_id: "run-1", project_id: "project-1", task_id: "task-1", module_id: "module-1",
      agent: "codex", scope: "task", state: "exited", updated_at: "2026-10-11T00:00:00Z",
    },
  } });
  useTerminalStore.setState({ sessions: { "session-1": {
    sessionId: "session-1", taskId: "task-1", projectId: "project-1", moduleId: "module-1",
    agent: "codex", agentRunId: "run-1", isPlanning: false, isInstant: false,
    status: "session_lost", initialPrompt: null, viewerAttachmentDeferred: true,
  } }, sessionByRun: { "run-1": "session-1" } });
});

it("[overhaul-815] names every missing stage skill after acknowledgement and when revisiting the terminal", async () => {
  const view = render(<Terminal sessionId="session-1" />);
  expect(screen.queryByTestId("stage-skill-warning")).toBeNull();
  act(() => useTerminalStore.getState().allowViewerAttachment("run-1"));
  const warning = await screen.findByRole("status", { name: "Stage skill warning" });
  expect(warning).toHaveAttribute("data-agent-run-id", "run-1");
  expect(warning).toHaveTextContent("codex");
  for (const name of ["structure-review", "interaction-design"]) expect(warning).toHaveTextContent(name);
  expect(screen.getByTestId("terminal-ended-state")).toBeVisible();
  view.unmount();
  render(<Terminal sessionId="session-1" />);
  expect(await screen.findByTestId("stage-skill-warning")).toBeVisible();
});

it("[overhaul-816] a new acknowledged run has no warning after its check finds the installed skills", async () => {
  act(() => useTerminalStore.getState().allowViewerAttachment("run-1"));
  const view = render(<Terminal sessionId="session-1" />);
  expect(await screen.findByTestId("stage-skill-warning")).toBeVisible();
  report = { ...missing, skills: missing.skills.map((skill) => ({ ...skill, status: "available" })) };
  act(() => {
    const run = useAgentStatusStore.getState().runs["run-1"]!;
    useAgentStatusStore.getState().upsertRun({ ...run, agent_run_id: "run-2" });
    const old = useTerminalStore.getState().sessions["session-1"]!;
    useTerminalStore.setState({ sessions: { "session-2": { ...old, sessionId: "session-2", agentRunId: "run-2" } } });
  });
  await act(async () => { view.rerender(<Terminal sessionId="session-2" />); });
  await waitFor(() => expect(screen.getByTestId("terminal-ended-state")).toBeVisible());
  expect(screen.queryByTestId("stage-skill-warning")).toBeNull();
});

it("[overhaul-817] unchecked skill reads name the provider, every requested skill and the failure", async () => {
  report = { ...missing, status: "unchecked", message: "Skill directory could not be read.",
    skills: missing.skills.map((skill) => ({ ...skill, status: "unchecked" })) };
  act(() => useTerminalStore.getState().allowViewerAttachment("run-1"));
  render(<Terminal sessionId="session-1" />);
  const warning = await screen.findByTestId("stage-skill-warning");
  expect(warning).toHaveTextContent("codex stage skill availability is unchecked");
  expect(warning).toHaveTextContent("structure-review, interaction-design");
  expect(warning).toHaveTextContent("Skill directory could not be read");
  expect(warning).not.toHaveTextContent("available to");
  expect(screen.getByTestId("terminal-ended-state")).toBeVisible();
});

it("[overhaul-818] a continued handoff updates the warning on the same acknowledged terminal", async () => {
  act(() => useTerminalStore.getState().allowViewerAttachment("run-1"));
  render(<Terminal sessionId="session-1" />);
  expect(await screen.findByTestId("stage-skill-warning")).toHaveTextContent("structure-review");
  act(() => {
    const run = useAgentStatusStore.getState().runs["run-1"]!;
    useAgentStatusStore.getState().upsertRun({
      ...run, updated_at: "2026-10-11T00:01:00Z",
      stage_skill_availability: JSON.stringify({ ...missing, skills: [{ ...missing.skills[0], requested: "tdd" }] }),
    });
  });
  await waitFor(() => expect(screen.getByTestId("stage-skill-warning")).toHaveTextContent("codex cannot see stage skills: tdd"));
  expect(screen.getByTestId("stage-skill-warning")).not.toHaveTextContent("structure-review");
  expect(screen.getByTestId("stage-skill-warning")).toHaveAttribute("data-agent-run-id", "run-1");
});

it("[overhaul-819] an unreadable persisted availability report remains an unchecked warning", async () => {
  report = { provider: "codex", status: "checked", skills: "invalid report" };
  act(() => useTerminalStore.getState().allowViewerAttachment("run-1"));
  render(<Terminal sessionId="session-1" />);
  expect(await screen.findByTestId("stage-skill-warning")).toHaveTextContent("availability is unchecked");
  expect(screen.getByTestId("terminal-ended-state")).toBeVisible();
});

function HistoricalRunRead() {
  const runs = useStoryEndedRuns("task-1");
  return <span>{runs.length ? "Historical run restored" : "Restoring history"}</span>;
}

it("[overhaul-820] a late historical run read preserves an already visible persisted warning", async () => {
  const compact = "c5d0401304e96ebf2921a9d19c73bab4";
  const publicId = "c5d04013-04e9-6ebf-2921-a9d19c73bab4";
  installDesktopGraphQlRuntime(async (document) => {
    if (documentOperationName(document) === "WorkItemEndedRuns") {
      return { work_item: { __typename: "WorktrackerIssueConnection", nodes: [{
        __typename: "WorktrackerIssue", id: "task-1", project_id: "project-1", module_id: "module-1",
        ended_runs: { __typename: "AgentRunsConnection", nodes: [{
          __typename: "AgentRuns", agent_run_id: publicId, agent: "codex", scope: "task", status: "exited",
          started_at: "2026-10-11T00:00:00Z", ended_at: "2026-10-11T00:01:00Z", exit_code: 0,
          launch_state: "Implement", launch_model: null, provider_session_id: null,
          stage_skill_availability: JSON.stringify(missing),
          terminal_session: { __typename: "AgentTerminalSessionsConnection", nodes: [{
            __typename: "AgentTerminalSessions", agent_run_id: publicId, terminated_at: null,
          }] },
        }] },
      }] } } as never;
    }
    return { agent_runs: { __typename: "AgentRunsConnection", nodes: [{
      __typename: "AgentRuns", id: publicId,
      stage_skill_availability: JSON.stringify(missing),
    }] } } as never;
  });
  // Install the read transport before the status fixture so both share one cache.
  useAgentStatusStore.setState({ projectId: "project-1", runs: { [compact]: {
    agent_run_id: compact, project_id: "project-1", task_id: "task-1", module_id: "module-1",
    agent: "codex", scope: "task", state: "exited", updated_at: "2026-10-11T00:00:00Z",
  } } });
  const session = useTerminalStore.getState().sessions["session-1"]!;
  useTerminalStore.setState({ sessions: { "session-1": {
    ...session, agentRunId: compact, viewerAttachmentDeferred: false,
  } } });
  const view = render(<Terminal sessionId="session-1" />);
  expect(await screen.findByTestId("stage-skill-warning")).toBeVisible();
  act(() => useAgentStatusStore.setState({ runs: {} }));
  view.rerender(<><Terminal sessionId="session-1" /><HistoricalRunRead /></>);
  await screen.findByText("Historical run restored");
  expect(screen.getByTestId("stage-skill-warning")).toHaveTextContent("structure-review, interaction-design");
});

it("[overhaul-821] a compact launch run ID reads the same warning as its public GraphQL UUID", async () => {
  const compact = "c5d0401304e96ebf2921a9d19c73bab4";
  const publicId = "c5d04013-04e9-6ebf-2921-a9d19c73bab4";
  installDesktopGraphQlRuntime(async () => ({
    agent_runs: { __typename: "AgentRunsConnection", nodes: [{
      __typename: "AgentRuns", id: publicId, stage_skill_availability: JSON.stringify(missing),
    }] },
  }) as never);
  useAgentStatusStore.setState({ projectId: "project-1", runs: { [compact]: {
    agent_run_id: compact, project_id: "project-1", task_id: "task-1", module_id: "module-1",
    agent: "codex", scope: "task", state: "exited", updated_at: "2026-10-11T00:00:00Z",
  } } });
  const session = useTerminalStore.getState().sessions["session-1"]!;
  useTerminalStore.setState({ sessions: { "session-1": {
    ...session, agentRunId: compact, viewerAttachmentDeferred: false,
  } } });
  render(<Terminal sessionId="session-1" />);
  expect(await screen.findByTestId("stage-skill-warning")).toHaveTextContent("codex cannot see stage skills: structure-review, interaction-design");
  expect(screen.getByTestId("terminal-ended-state")).toBeVisible();
});
