import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanHeader } from "../features/sprints/planning/PlanHeader";
import { PlanDetailPane } from "../features/sprints/planning/PlanDetailPane";
import { SuggestionRows } from "../features/sprints/planning/SuggestionRows";
import type { SprintSuggestionRecordFragment } from "../features/sprints/generated/sprints.documents";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { openPlanSprint, usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { SuggestionAgentBox } from "../features/sprints/suggestions/SuggestionAgentBox";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";

const suggestion = {
  __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: "sprint", goalId: "goal",
  issueId: "story", proposedName: null, proposedEpicId: null, reason: "Fits the release goal",
  status: "waiting", runId: "run", createdAt: "2026-10-04", issue: {
    __typename: "WorktrackerIssue", id: "story", name: "Ship planning", sequenceId: 1, rank: "V",
    parentId: null, moduleId: "epic", stateId: "idea", stateRevision: 1, sprintId: null,
    updatedAt: "2026-10-04", issueType: { id: "story-type", name: "Story" },
  },
} satisfies SprintSuggestionRecordFragment;

describe("Plan sprint header", () => {
  beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));
  it("[overhaul-463] observes completion in Plan, retries failed result reads and reviews a moduleless suggestion", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    http.workItems([workItem({ id: "story", name: "Ship planning", parent_id: null })]);
    let runState = "running";
    let status = "waiting";
    let failResults = false;
    const decisions: unknown[] = [];
    const moduleless = { ...suggestion, issue: { ...suggestion.issue, moduleId: null } };
    const graph = {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
      states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", id: "idea", name: "Implement", group: "backlog", color: "", sortOrder: 0 }] },
      issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "story-type", name: "Story", level: "task" }, { __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
      modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: "module-1", name: "Alpha", sequenceId: 2, presentation: { __typename: "WorktrackerModulePresentationConnection", nodes: [] } }] },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint", name: "Release", status: "planned", createdAt: "2026-10-04" }] },
      workItems: { __typename: "WorktrackerIssueConnection", nodes: [moduleless.issue] },
    };
    function Planning() {
      const workspace = usePlanWorkspace();
      return workspace.sprintId
        ? <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={(id) => <p>Selected ticket {id}</p>} />
        : <><SuggestionAgentBox projectId="project-1" sprintId="sprint" /><button onClick={() => openPlanSprint("sprint")}>Plan sprint</button></>;
    }
    mountStudio({ http, children: <Planning />,
      graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
        switch (documentOperationName(document)) {
          case "PlanningGraph": return graph as TResult;
          case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [{
            __typename: "WorktrackerSprint", id: "sprint", status: "planned", goalsRevisedAt: null, suggestionRunId: "run",
            goals: { __typename: "WorktrackerSprintGoalConnection", nodes: [{ __typename: "WorktrackerSprintGoal", id: "goal", text: "Release" }] },
            suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: runState === "succeeded" && status === "waiting" ? [{ __typename: "WorktrackerSprintSuggestion", id: "suggestion" }] : [] },
          }] } } as TResult;
          case "SprintSuggestionExecutionRun": return { agentExecutions: { __typename: "AgentExecutionsConnection", nodes: [{
            __typename: "AgentExecutions", id: "execution", agentRunId: "run", sprintId: "sprint", state: runState,
            outputType: "sprint_suggestions_v1", goalsRevision: null, error: null, cancelRequested: false, createdAt: "2026-10-04", updatedAt: "2026-10-04",
          }] } } as TResult;
          case "SprintSuggestions":
            if (failResults) throw new Error("Results temporarily unavailable");
            return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: runState === "succeeded" ? [{ ...moduleless, status }] : [] } } as TResult;
          case "UpdateSprintSuggestion":
            decisions.push(variables);
            status = "dismissed";
            return { update_sprint_suggestion: { ...moduleless, status } } as TResult;
          default: return http.executeGraphQl(document, variables);
        }
      },
    });
    expect(await screen.findByText("An agent is looking for stories…")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Plan sprint" }));
    expect(await screen.findByText("Agent still working…")).toBeVisible();
    failResults = true;
    runState = "succeeded";
    expect(await screen.findByRole("button", { name: "Retry status" }, { timeout: 3000 })).toBeEnabled();
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("Results temporarily unavailable"))).toBe(true);
    failResults = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
    const backlog = within(screen.getByTestId("plan-backlog"));
    const tabName = "No epic, 1 backlog stories, 1 waiting suggestions";
    await screen.findByRole("button", { name: "Add epic" });
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: tabName }));
    expect(await backlog.findByRole("button", { name: "✦ Ship planning" })).toBeVisible();
    expect(screen.getAllByText("✦ 1 to review")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: tabName })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close No epic" }));
    expect(backlog.queryByRole("button", { name: "✦ Ship planning" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: tabName }));
    fireEvent.click(backlog.getByRole("button", { name: "✦ Ship planning" }));
    expect(await screen.findByText("Selected ticket story")).toBeVisible();
    expect(decisions).toEqual([]);
    fireEvent.click(backlog.getByRole("button", { name: "Dismiss Ship planning" }));
    await waitFor(() => expect(backlog.queryByRole("button", { name: "✦ Ship planning" })).not.toBeInTheDocument());
    expect(decisions).toEqual([{ id: "suggestion", status: "dismissed" }]);
    fireEvent.click(screen.getByRole("button", { name: "Back to sprints" }));
    expect(await screen.findByText(/0 suggestions ready/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Review in Plan →" })).toBeEnabled();
  });
  it("[overhaul-457] waits for waiting suggestions before offering an epic to finish", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    let release = () => {};
    const pendingSuggestions = new Promise<void>((resolve) => { release = resolve; });
    const graph = {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
      states: { __typename: "WorktrackerStateConnection", nodes: [] },
      issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
      modules: { __typename: "WorktrackerIssueConnection", nodes: ["Alpha", "Beta"].map((name, index) => ({ __typename: "WorktrackerIssue", id: `epic-${index}`, name, sequenceId: index + 1, presentation: { __typename: "WorktrackerModulePresentationConnection", nodes: [] } })) },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint", name: "Release", status: "planned", createdAt: "2026-10-04" }] },
      workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
    };
    usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint" });
    mountStudio({ http, children: <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={(id) => <p>{id}</p>} />,
      graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
        switch (documentOperationName(document)) {
          case "PlanningGraph": return graph as TResult;
          case "SprintSuggestions":
            await pendingSuggestions;
            return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [{ ...suggestion, issueId: null, issue: null, proposedName: "Plan Beta", proposedEpicId: "epic-1" }] } } as TResult;
          case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
          default: return http.executeGraphQl(document, variables);
        }
      },
    });
    await screen.findByTestId("plan-sprint");
    try {
      expect(screen.queryByRole("button", { name: /^Done with / })).not.toBeInTheDocument();
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
    } finally {
      await act(async () => { release(); await pendingSuggestions; });
    }
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: "Beta, 0 backlog stories, 1 waiting suggestions" }));
    expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories, 1 waiting suggestions" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Done with Beta" }));
    expect(screen.queryByRole("tab", { name: "Beta, 0 backlog stories, 1 waiting suggestions" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("plan-backlog")).getByText("No epic open. Use + Add epic to plan another one.")).toBeVisible();
  });
  it("[overhaul-439] shows sprint-wide counts and read-only goals with separate back and Done actions", () => {
    const back = vi.fn();
    const done = vi.fn();
    render(<PlanHeader sprintName="Release" storyCount={5}
      goals={[{ id: "goal", text: "Ship planning" }]} waitingCount={2}
      agentRunning={false} onBack={back} onDone={done} />);
    expect(screen.getByText("Release")).toHaveAttribute("title", "Release");
    expect(screen.getByText("5 stories")).toBeVisible();
    expect(screen.getByText("1 goal")).toHaveAttribute("title", "G1. Ship planning");
    expect(screen.getByText("✦ 2 to review")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to sprints" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(back).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("[overhaul-440] focuses one epic's backlog while keeping every sprint story visible across tab switches", async () => {
    const http = fixture();
    http.tree("epic-0", { rootIds: [], children: {}, order: [] });
    http.tree("epic-1", { rootIds: [], children: {}, order: [] });
    const graph = {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
      states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", id: "idea", name: "Idea", group: "backlog", color: "#888", sortOrder: 0 }, { __typename: "WorktrackerState", id: "implement", name: "Implement", group: "started", color: "#888", sortOrder: 1 }] },
      issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "story", name: "Story", level: "task" }, { __typename: "WorktrackerIssuetype", id: "epic", name: "Epic", level: "module" }] },
      modules: { __typename: "WorktrackerIssueConnection", nodes: ["Module 1", "Module 2"].map((name, index) => ({ __typename: "WorktrackerIssue", id: `epic-${index}`, name, sequenceId: index + 1, presentation: { __typename: "WorktrackerModulePresentationConnection", nodes: [] } })) },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint", name: "Release", status: "planned", createdAt: "2026-10-04" }] },
      workItems: { __typename: "WorktrackerIssueConnection", nodes: [0, 1, 2, 3].map((index) => ({ __typename: "WorktrackerIssue", id: `story-${index}`, name: `Story ${index}`, sequenceId: index + 3, rank: `${index}`, parentId: null, moduleId: `epic-${index % 2}`, stateId: "idea", stateRevision: 1, sprintId: index < 2 ? "sprint" : null, updatedAt: "2026-10-04", issueType: { __typename: "WorktrackerIssuetype", id: "story", name: "Story" } })) },
    };
    usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint" });
    mountStudio({ http, children: <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={(id) => <p>{id}</p>} />,
      graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
        switch (documentOperationName(document)) {
          case "PlanningGraph": return graph as TResult;
          case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] } } as TResult;
          case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
          default: return http.executeGraphQl(document, variables);
        }
      },
    });
    const backlog = within(await screen.findByTestId("plan-backlog"));
    const planned = within(screen.getByTestId("plan-sprint-items"));
    expect(backlog.getByText("No epic open. Use + Add epic to plan another one.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: "Module 1, 1 backlog stories" }));
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: "Module 2, 1 backlog stories" }));
    fireEvent.click(screen.getByRole("tab", { name: "Module 1, 1 backlog stories" }));
    expect(backlog.getByText("Story 2")).toBeVisible();
    expect(backlog.queryByText("Story 3")).not.toBeInTheDocument();
    expect(planned.getByText("Story 0")).toBeVisible();
    expect(planned.getByText("Story 1")).toBeVisible();
    expect(backlog.getByRole("button", { name: "Done with Module 1 → next" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next epic" }));
    expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["epic-0", "epic-1"], activeEpicId: "epic-1" });
    expect(await backlog.findByText("Story 3")).toBeVisible();
    expect(backlog.queryByText("Story 2")).not.toBeInTheDocument();
    fireEvent.click(backlog.getByRole("button", { name: "Done with Module 2 → next" }));
    await waitFor(() => expect(usePlanWorkspace.getState().visits.sprint.epicTabs).toEqual(["epic-0"]));
    expect(planned.getByText("Story 1")).toBeVisible();
    expect(backlog.getByText("Story 2")).toBeVisible();
    expect(backlog.getByRole("button", { name: "Done with Module 1" })).toBeVisible();
  });
  it("[overhaul-441] opens a suggested story from its row without accepting it", () => {
    const open = vi.fn();
    const accept = vi.fn();
    const dismiss = vi.fn();
    render(<SuggestionRows suggestions={[suggestion]} goals={[{ id: "goal", text: "Release" }]}
      openItem={null} busy={false} onOpen={open} onAccept={accept} onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "✦ Ship planning" }));
    expect(open).toHaveBeenCalledWith(suggestion);
    expect(accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Accept Ship planning" }));
    expect(accept).toHaveBeenCalledWith(suggestion);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Ship planning" }));
    expect(dismiss).toHaveBeenCalledWith(suggestion);
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByText("G1")).toHaveAttribute("title", "Release");
  });
  it("[overhaul-442] renders the unchanged story detail below its suggestion reason and removes the banner for a ticket", () => {
    const close = vi.fn();
    const view = render(<PlanDetailPane openItem="suggestion:suggestion" suggestions={[suggestion]} busy={false}
      renderWorkItemDetail={(id) => <p>Selected ticket {id}</p>} onAccept={() => {}} onDismiss={() => {}} onClose={close} />);
    expect(screen.getByText("Fits the release goal")).toBeVisible();
    expect(screen.getByText("Selected ticket story")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close selected ticket" }));
    expect(close).toHaveBeenCalledOnce();
    view.rerender(<PlanDetailPane openItem="story" suggestions={[suggestion]} busy={false}
      renderWorkItemDetail={(id) => <p>Selected ticket {id}</p>} onAccept={() => {}} onDismiss={() => {}} onClose={close} />);
    expect(screen.getByText("Selected ticket story")).toBeVisible();
    expect(screen.queryByText("Fits the release goal")).not.toBeInTheDocument();
  });
});
