import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { PlanningGraphDocument } from "../features/planning-graph";
import type { PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import { SprintSuggestionsDocument } from "../features/sprints/generated/sprints.documents";
import { studioApolloClient } from "../shared/apollo/client";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { clickWithCurrentChange, flushInput } from "./planMovePolicyFixture";
import { mountProposal, reviewProposal } from "./planSuggestionFixture";

it("[overhaul-778] a suggestion accept captured before a new visit generation sends no write", async () => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  const accept = detail.getByRole("button", { name: "Create story" });
  clickWithCurrentChange(accept, () => usePlanWorkspace.setState((state) => ({ generation: state.generation + 1 })));
  await flushInput();
  expect(plan.decisions).toEqual([]);
});

function changeGraph(edit: (graph: PlanningGraphQuery) => PlanningGraphQuery) {
  const client = studioApolloClient();
  const graph = client.readQuery({ query: PlanningGraphDocument, variables: { projectId: "project-1" } })!;
  client.writeQuery({ query: PlanningGraphDocument, variables: { projectId: "project-1" }, data: edit(graph) });
}

it("[overhaul-779] suggestion Undo is unavailable while authoritative graph reads are incomplete", async () => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  fireEvent.click(detail.getByRole("button", { name: "Dismiss" }));
  const undo = await screen.findByRole("button", { name: "Undo Agent wording suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  const release = plan.holdGraph();
  const client = studioApolloClient();
  act(() => { client.cache.evict({ id: client.cache.identify({ __typename: "WorktrackerSprint", id: "release" }), fieldName: "name" }); });
  await flushInput();
  try {
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo Agent wording suggestion" })).toBeDisabled());
    fireEvent.click(undo);
    expect(plan.decisions).toEqual([{ id: "proposal", status: "dismissed" }]);
  } finally { await act(async () => { release(); }); }
});

it("[overhaul-780] suggestion acceptance rechecks a sprint completed during input", async () => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  clickWithCurrentChange(detail.getByRole("button", { name: "Create story" }), () => changeGraph((graph) => ({ ...graph,
    sprints: { ...graph.sprints, nodes: graph.sprints.nodes.map((sprint) => ({ ...sprint, status: "completed" })) },
  })));
  await flushInput();
  expect(plan.decisions).toEqual([]);
  expect(detail.getByRole("button", { name: "Create story" })).toBeDisabled();
  expect(detail.getByRole("button", { name: "Dismiss" })).toBeEnabled();
});

it("[overhaul-781] dismiss and Undo stay available after completion, workflow, hierarchy and epic focus changes", async () => {
  const plan = mountProposal({ existing: true });
  await screen.findByRole("button", { name: "Add epic" });
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Module 1,/ }));
  const dismiss = screen.getByRole("button", { name: "Dismiss My release story" });
  clickWithCurrentChange(dismiss, () => {
    usePlanWorkspace.setState((state) => ({ visits: { ...state.visits, release: { epicTabs: ["module-1"], activeEpicId: null } } }));
    changeGraph((graph) => ({ ...graph,
      sprints: { ...graph.sprints, nodes: graph.sprints.nodes.map((sprint) => ({ ...sprint, status: "completed" })) },
      states: { ...graph.states, nodes: graph.states.nodes.map((state) => ({ ...state, group: "completed" })) },
      workItems: { ...graph.workItems, nodes: graph.workItems.nodes.map((item) => ({ ...item, parentId: "other-story" })) },
    }));
  });
  const undo = await screen.findByRole("button", { name: "Undo My release story suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  fireEvent.click(undo);
  await waitFor(() => expect(plan.decisions).toEqual([{ id: "proposal", status: "dismissed" }, { id: "proposal", status: "waiting" }]));
});

it("[overhaul-782] a suggestion read begun during input blocks writes and failed reads keep both controls unavailable", async () => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  const release = plan.holdSuggestions();
  plan.failNextSuggestionRead();
  let refresh: Promise<unknown> | undefined;
  clickWithCurrentChange(detail.getByRole("button", { name: "Create story" }), () => {
    refresh = studioApolloClient().refetchQueries({ include: [SprintSuggestionsDocument] }).catch(() => {});
  });
  await flushInput();
  expect(plan.decisions).toEqual([]);
  await act(async () => { release(); await refresh; });
  expect(detail.getByRole("button", { name: "Create story" })).toBeDisabled();
  expect(detail.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  expect(plan.decisions).toEqual([]);
});

it.each(["refresh", "inspection"])("[overhaul-783] a %s recovery control captured before a new generation sends no reads or writes", async (recovery) => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  if (recovery === "inspection") plan.loseNextDecision("after");
  plan.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const retry = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  const reads = { ...plan.reads };
  const decisions = [...plan.decisions];
  clickWithCurrentChange(retry, () => usePlanWorkspace.setState((state) => ({ generation: state.generation + 1 })));
  await flushInput();
  expect(plan.decisions).toEqual(decisions);
  expect(plan.reads).toEqual(reads);
  expect(retry).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry suggestion refresh" })).toHaveTextContent("Inspect suggestion");
});

it("[overhaul-786] a suggestion removed from the authoritative collection during input cannot be accepted", async () => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  const reads = { ...plan.reads };
  clickWithCurrentChange(detail.getByRole("button", { name: "Create story" }), () => {
    const client = studioApolloClient();
    const current = client.readQuery({ query: SprintSuggestionsDocument, variables: { sprintId: "release" } })!;
    client.writeQuery({ query: SprintSuggestionsDocument, variables: { sprintId: "release" },
      data: { worktrackerSprintSuggestion: { ...current.worktrackerSprintSuggestion, nodes: [] } } });
  });
  await flushInput();
  expect(plan.decisions).toEqual([]);
  expect(plan.reads).toEqual(reads);
});

it.each(["missing", "foreign"])("[overhaul-787] a suggestion rejects a current graph whose owning project is %s", async (owner) => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  const reads = { ...plan.reads };
  clickWithCurrentChange(detail.getByRole("button", { name: "Dismiss" }), () => changeGraph((graph) => ({ ...graph,
    project: { ...graph.project, nodes: owner === "missing" ? [] : [{ ...graph.project.nodes[0], id: "foreign-project" }] },
  })));
  await flushInput();
  expect(plan.decisions).toEqual([]);
  expect(plan.reads).toEqual(reads);
});

it("[overhaul-788] two mounted suggestion controls share a current synchronous pending guard", async () => {
  const plan = mountProposal();
  await reviewProposal();
  render(<StudioApolloProvider><PlanSprintView projectId="project-1" sprintId="release" renderWorkItemDetail={() => null} /></StudioApolloProvider>);
  const controls = screen.getAllByTestId("plan-sprint").map((view) => within(view).getByRole("button", { name: "Accept Agent wording" }));
  const release = plan.holdDecision();
  try {
    act(() => { for (const control of controls) fireEvent.click(control); });
    await flushInput();
    expect(plan.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
    for (const control of controls) expect(control).toBeDisabled();
  } finally { await act(async () => { release(); }); }
});

it("[overhaul-789] an unresolved Undo keeps the known decision but disables repeat Undo until inspection", async () => {
  const plan = mountProposal();
  const detail = await reviewProposal();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  await screen.findByText("Selected ticket created-story");
  const undo = screen.getByRole("button", { name: "Undo Agent wording suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  plan.loseNextDecision("before");
  plan.failNextRefresh();
  fireEvent.click(undo);
  const inspection = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(inspection).toHaveTextContent("Inspect suggestion");
  expect(screen.getByRole("button", { name: "Undo Agent wording suggestion" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo Agent wording suggestion" }));
  expect(plan.decisions).toEqual([{ id: "proposal", status: "accepted" }, { id: "proposal", status: "waiting" }]);
});

it("[overhaul-790] a partial authoritative suggestion response preserves remembered epic intent until a complete read", async () => {
  const plan = mountProposal();
  await reviewProposal();
  const saved = usePlanWorkspace.getState().visits.release;
  const reads = { ...plan.reads };
  plan.omitSuggestionStatus();
  const client = studioApolloClient();
  await act(async () => {
    client.cache.evict({ id: client.cache.identify({ __typename: "WorktrackerSprintSuggestion", id: "proposal" }), fieldName: "status" });
    await client.refetchQueries({ include: [SprintSuggestionsDocument] });
  });
  act(() => changeGraph((graph) => ({ ...graph, modules: { ...graph.modules, nodes: [] } })));
  await flushInput();
  expect(usePlanWorkspace.getState().visits.release).toEqual(saved);
  expect(screen.getByRole("tab", { name: /Deleted epic/ })).toHaveAttribute("aria-selected", "true");
  expect(plan.decisions).toEqual([]);
  expect(plan.reads).toEqual({ ...reads, SprintSuggestions: reads.SprintSuggestions + 1 });
  plan.omitSuggestionStatus(false);
  await act(async () => { await client.refetchQueries({ include: [SprintSuggestionsDocument] }); });
  expect(await screen.findByRole("tab", { name: /No epic, 0 backlog stories, 1 waiting suggestions/ })).toHaveAttribute("aria-selected", "true");
});
