import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { StageSkillWarning } from "../features/agents/terminal/StageSkillWarning";
import { readAgentStatusHolding } from "../features/agents/status/apolloHolding";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";
import { studioApolloClient } from "../shared/apollo/client";
import { AgentRunStageSkillAvailabilityDocument } from "../features/agents/terminal/generated/stageSkillWarning.documents";
import { WorkItemEndedRunsDocument } from "../features/agents/terminal/generated/workItemRunRestoration.documents";
import { documentOperationName } from "../graphql-foundation/typedDocument";

const missingTdd = JSON.stringify({
  status: "checked", provider: "codex", code: null, message: null,
  searched_roots: ["/worktree/.agents/skills"],
  skills: [{ requested: "tdd", status: "missing", installed_name: null, location: null, reason: null }],
});
const oldWarning = missingTdd.replace('"tdd"', '"structure-review"');
const availableTdd = missingTdd.replace('"missing"', '"available"');
const runRead = (report: string | null) => ({ agent_runs: { __typename: "AgentRunsConnection", nodes: [{
  __typename: "AgentRuns", id: "run-1", stage_skill_availability: report,
}] } });
const readWarning = () => studioApolloClient().query({ query: AgentRunStageSkillAvailabilityDocument,
  variables: { agentRunId: "run-1" }, fetchPolicy: "network-only" });

function seedRun() {
  useAgentStatusStore.setState({ projectId: "project-1", runs: { "run-1": {
    agent_run_id: "run-1", project_id: "project-1", task_id: "task-1", module_id: "module-1",
    agent: "codex", scope: "task", state: "working", updated_at: "2026-10-11T00:00:00Z",
  } } });
}
function handoff(report: string | null, at = "2026-10-11T00:01:00Z") {
  act(() => useAgentStatusStore.getState().upsertRun({ ...useAgentStatusStore.getState().runs["run-1"]!,
    updated_at: at, stage_skill_availability: report,
  }));
}
async function expectReport(report: string | null) {
  await waitFor(() => {
    if (report === missingTdd) expect(screen.getByTestId("stage-skill-warning")).toHaveTextContent("codex cannot see stage skills: tdd");
    else expect(screen.queryByTestId("stage-skill-warning")).toBeNull();
    expect(readAgentStatusHolding().runs["run-1"]?.stage_skill_availability).toBe(report);
  });
}
async function pendingRead(initialReport: string | null) {
  let settle!: () => void;
  let started = false;
  let reads = 0;
  installDesktopGraphQlRuntime(async () => {
    if (++reads === 1) return runRead(initialReport) as never;
    started = true;
    return new Promise<never>((resolve) => { settle = () => resolve(runRead(initialReport) as never); });
  });
  seedRun();
  await readWarning();
  render(<StageSkillWarning agentRunId="run-1" />);
  await waitFor(() => expect(started).toBe(true));
  return async () => { await act(async () => settle()); };
}

beforeEach(() => {
  installDesktopGraphQlRuntime();
});

it.each([
  { old: oldWarning, current: missingTdd, behavior: "warning creation after an older non-null read" },
  { old: null, current: availableTdd, behavior: "successful check after an older null read" },
  { old: oldWarning, current: availableTdd, behavior: "successful check after an older warning read" },
  { old: oldWarning, current: null, behavior: "explicit warning clearing after an older warning read" },
])("[overhaul-828] preserves $behavior in the banner and live holding", async ({ old, current }) => {
  const settle = await pendingRead(old);
  handoff(current);
  await expectReport(current);
  await settle();
  await expectReport(current);
});

it("[overhaul-829] an older historical read with aliased run identity preserves the handoff report while accepting unrelated fields", async () => {
  let finish!: (value: never) => void;
  let started = false;
  installDesktopGraphQlRuntime(async (document) => {
    if (documentOperationName(document) !== "WorkItemEndedRuns") return runRead(null) as never;
    started = true;
    return new Promise<never>((resolve) => { finish = resolve; });
  });
  seedRun();
  await readWarning();
  render(<StageSkillWarning agentRunId="run-1" />);
  const history = studioApolloClient().query({ query: WorkItemEndedRunsDocument,
    variables: { issueId: "task-1", issueType: "story", scopes: ["task"], limit: 100 }, fetchPolicy: "network-only" });
  await waitFor(() => expect(started).toBe(true));
  handoff(missingTdd);
  await expectReport(missingTdd);
  await act(async () => {
    finish({ work_item: { __typename: "WorktrackerIssueConnection", nodes: [{
      __typename: "WorktrackerIssue", id: "task-1", project_id: "project-1", module_id: "module-1",
      ended_runs: { __typename: "AgentRunsConnection", nodes: [{
        __typename: "AgentRuns", agent_run_id: "run-1", agent: "codex", scope: "task", status: "exited",
        started_at: "2026-10-11T00:00:00Z", ended_at: "2026-10-11T00:00:30Z", exit_code: 7,
        launch_state: "Implement", launch_model: null, stage_skill_availability: oldWarning, provider_session_id: null,
        terminal_session: { __typename: "AgentTerminalSessionsConnection", nodes: [] },
      }] },
    }] } } as never);
    await history;
  });
  await expectReport(missingTdd);
  expect(readAgentStatusHolding().runs["run-1"]?.exit_code).toBe(7);
});

it.each([null, availableTdd, missingTdd])("[overhaul-830] accepts a fresh read after handoff: %s", async (fresh) => {
  let response: string | null = oldWarning;
  installDesktopGraphQlRuntime(async () => runRead(response) as never);
  seedRun();
  await readWarning();
  render(<StageSkillWarning agentRunId="run-1" />);
  await screen.findByTestId("stage-skill-warning");
  // Settle the mounted cache-and-network read before the handoff.
  await act(async () => { await readWarning(); });
  handoff(missingTdd);
  await expectReport(missingTdd);
  response = fresh;
  await act(async () => { await readWarning(); });
  await expectReport(fresh);
});

it("[overhaul-831] preserves recreated warning ownership when a pending read spans creation, clearing and recreation", async () => {
  const settle = await pendingRead(null);
  handoff(missingTdd);
  await expectReport(missingTdd);
  handoff(null, "2026-10-11T00:02:00Z");
  await expectReport(null);
  handoff(missingTdd, "2026-10-11T00:03:00Z");
  await expectReport(missingTdd);
  await settle();
  await expectReport(missingTdd);
});

it("[overhaul-827] a delayed older null read cannot erase a new handoff warning or its live holding", async () => {
  let resolveRead!: (value: never) => void;
  let started = false;
  let reads = 0;
  installDesktopGraphQlRuntime(async () => {
    if (++reads === 1) return { agent_runs: { __typename: "AgentRunsConnection", nodes: [{
      __typename: "AgentRuns", id: "run-1", stage_skill_availability: null,
    }] } } as never;
    started = true;
    return new Promise<never>((resolve) => { resolveRead = resolve; });
  });
  useAgentStatusStore.setState({ projectId: "project-1", runs: { "run-1": {
    agent_run_id: "run-1", project_id: "project-1", task_id: "task-1", module_id: "module-1",
    agent: "codex", scope: "task", state: "working", updated_at: "2026-10-11T00:00:00Z",
  } } });
  await studioApolloClient().query({ query: AgentRunStageSkillAvailabilityDocument, variables: { agentRunId: "run-1" }, fetchPolicy: "network-only" });
  render(<StageSkillWarning agentRunId="run-1" />);
  await waitFor(() => expect(started).toBe(true));
  act(() => useAgentStatusStore.getState().upsertRun({
    ...useAgentStatusStore.getState().runs["run-1"]!,
    updated_at: "2026-10-11T00:01:00Z", stage_skill_availability: missingTdd,
  }));
  expect(await screen.findByTestId("stage-skill-warning")).toHaveTextContent("codex cannot see stage skills: tdd");
  await act(async () => resolveRead({ agent_runs: { __typename: "AgentRunsConnection", nodes: [{
    __typename: "AgentRuns", id: "run-1", stage_skill_availability: null,
  }] } } as never));
  expect(screen.getByTestId("stage-skill-warning")).toHaveTextContent("codex cannot see stage skills: tdd");
  expect(readAgentStatusHolding().runs["run-1"]?.stage_skill_availability).toBe(missingTdd);
});
