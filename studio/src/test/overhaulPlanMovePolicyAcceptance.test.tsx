import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { studioApolloClient } from "../shared/apollo/client";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { PlanningGraphDocument } from "../features/planning-graph";
import { clickWithCurrentChange, flushInput, focusBeta, incomingButton, mountMovePlan } from "./planMovePolicyFixture";

it("[overhaul-747] an incoming move rechecks epic focus changed during the same input event", async () => {
  const plan = mountMovePlan();
  const button = await incomingButton();
  expect(button).toBeEnabled();
  clickWithCurrentChange(button, focusBeta);
  await flushInput();
  expect(plan.writes).toEqual([]);
});

it("[overhaul-748] an Undo overtaken during input stays discarded when assignment immediately returns", async () => {
  const plan = mountMovePlan();
  fireEvent.click(await incomingButton());
  const undo = await screen.findByRole("button", { name: /Undo .+-1 move/ });
  await waitFor(() => expect(undo).toBeEnabled());
  act(() => {
    clickWithCurrentChange(undo, () => plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems,
      nodes: graph.workItems.nodes.map((item) => ({ ...item, sprintId: "second" })) } })));
    plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems, nodes: graph.workItems.nodes.map((item) => ({ ...item, sprintId: "sprint" })) } }));
  });
  await flushInput();
  expect(plan.writes).toEqual([{ id: "story", sprintId: "sprint" }]);
  expect(screen.queryByRole("button", { name: /Undo .+-1 move/ })).not.toBeInTheDocument();
});

it("[overhaul-749] Retry rejects a graph refetch begun during input and explains retained-graph loading and error", async () => {
  let failMove = true;
  let graphRead: Promise<void> | undefined;
  let rejectRead = (_error: Error) => {};
  const plan = mountMovePlan({ move: async () => { if (failMove) throw new Error("Move rejected"); }, graphRead: async () => { await graphRead; } });
  fireEvent.click(await incomingButton());
  const retry = await screen.findByRole("button", { name: /Retry moving .+-1 to Release/ });
  await waitFor(() => expect(retry).toBeEnabled());
  failMove = false;
  graphRead = new Promise<void>((_resolve, reject) => { rejectRead = reject; });
  let refresh: Promise<unknown> | undefined;
  clickWithCurrentChange(retry, () => { refresh = studioApolloClient().refetchQueries({ include: [PlanningGraphDocument] }).catch(() => {}); });
  await flushInput();
  expect(plan.writes).toHaveLength(1);
  expect(retry).toBeDisabled();
  expect(screen.getByText("This Story is unavailable for retry.")).toBeVisible();
  await act(async () => { rejectRead(new Error("Planning read failed")); await refresh; });
  expect(screen.getByRole("button", { name: /Retry moving .+-1 to Release/ })).toBeDisabled();
  expect(screen.getByText("This Story is unavailable for retry.")).toBeVisible();
  expect(plan.writes).toHaveLength(1);
});

it("[overhaul-750] temporary incomplete graph reads disable Undo without discarding its normalized assignment", async () => {
  const plan = mountMovePlan();
  fireEvent.click(await incomingButton());
  const undo = await screen.findByRole("button", { name: /Undo .+-1 move/ });
  await waitFor(() => expect(undo).toBeEnabled());
  const client = studioApolloClient();
  act(() => { client.cache.evict({ id: client.cache.identify({ __typename: "WorktrackerSprint", id: "sprint" }), fieldName: "name" }); });
  await flushInput();
  fireEvent.click(undo);
  expect(plan.writes).toHaveLength(1);
  act(() => { plan.change((graph) => graph); });
  const restored = await screen.findByRole("button", { name: /Undo .+-1 move/ });
  expect(restored).toBeEnabled();
  fireEvent.click(restored);
  await waitFor(() => expect(plan.writes).toHaveLength(2));
});

it("[overhaul-751] a Retry requires its origin and stays discarded after an observed assignment returns", async () => {
  const plan = mountMovePlan({ move: async () => { throw new Error("Move rejected"); } });
  fireEvent.click(await incomingButton());
  const retry = await screen.findByRole("button", { name: /Retry moving .+-1 to Release/ });
  await waitFor(() => expect(retry).toBeEnabled());
  act(() => {
    clickWithCurrentChange(retry, () => plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems,
      nodes: graph.workItems.nodes.map((item) => ({ ...item, sprintId: "second" })) } })));
    plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems, nodes: graph.workItems.nodes.map((item) => ({ ...item, sprintId: null })) } }));
  });
  await flushInput();
  expect(plan.writes).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /Retry moving .+-1 to Release/ })).not.toBeInTheDocument();
});

it("[overhaul-752] Retry explanations preserve completion, hierarchy, workflow and epic-focus precedence", async () => {
  const plan = mountMovePlan({ move: async () => { throw new Error("Move rejected"); } });
  fireEvent.click(await incomingButton());
  const retry = await screen.findByRole("button", { name: /Retry moving .+-1 to Release/ });
  await waitFor(() => expect(retry).toBeEnabled());
  act(focusBeta);
  expect(screen.getByText(/Focus Module 1 to show this Story in the Backlog and retry/)).toBeVisible();
  act(() => plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems, nodes: graph.workItems.nodes.map((item) => ({ ...item, stateId: "done" })) } })));
  expect(await screen.findByText(/This Story is in Done, outside the planning Backlog/)).toBeVisible();
  act(() => plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems, nodes: [
    { ...graph.workItems.nodes[0], parentId: "parent" }, { ...graph.workItems.nodes[0], id: "parent", name: "Parent", parentId: null },
  ] } })));
  expect(await screen.findByText(/Nested Stories are outside the planning Backlog/)).toBeVisible();
  act(() => plan.change((graph) => ({ ...graph, sprints: { ...graph.sprints, nodes: graph.sprints.nodes.map((sprint) => ({ ...sprint, status: "completed" })) } })));
  expect(await screen.findByText("This sprint is completed and closed to new work.")).toBeVisible();
  expect(retry).toBeDisabled();
  fireEvent.click(retry);
  expect(plan.writes).toHaveLength(1);
});

it("[overhaul-753] outgoing work can leave a completed sprint despite current hierarchy, workflow and epic focus", async () => {
  const plan = mountMovePlan({ assignment: "sprint" });
  const outgoing = await screen.findByRole("button", { name: /Return .+-1 to backlog/ });
  clickWithCurrentChange(outgoing, () => {
    focusBeta();
    plan.change((graph) => ({ ...graph, sprints: { ...graph.sprints, nodes: graph.sprints.nodes.map((sprint) => ({ ...sprint, status: "completed" })) },
      workItems: { ...graph.workItems, nodes: [{ ...graph.workItems.nodes[0], parentId: "parent", stateId: "done" },
        { ...graph.workItems.nodes[0], id: "parent", name: "Parent", parentId: null }] } }));
  });
  await waitFor(() => expect(plan.writes).toEqual([{ id: "story", sprintId: null }]));
  const undo = await screen.findByRole("button", { name: /Undo .+-1 move/ });
  expect(undo).toBeDisabled();
  expect(await screen.findByText("This sprint is completed and closed to new work.")).toBeVisible();
});

it.each(["move", "retry", "undo"])("[overhaul-758] a %s control captured by an older generation sends no write", async (stage) => {
  let reject = stage === "retry";
  const plan = mountMovePlan({ move: async () => { if (reject) throw new Error("Move rejected"); } });
  let control = await incomingButton();
  if (stage !== "move") {
    fireEvent.click(control);
    control = await screen.findByRole("button", { name: stage === "retry" ? /Retry moving .+-1 to Release/ : /Undo .+-1 move/ });
    await waitFor(() => expect(control).toBeEnabled());
  }
  reject = false;
  const count = plan.writes.length;
  clickWithCurrentChange(control, () => usePlanWorkspace.setState((state) => ({ generation: state.generation + 1 })));
  await flushInput();
  expect(plan.writes).toHaveLength(count);
  expect(screen.queryByRole("button", { name: /Retry moving .+-1 to Release|Undo .+-1 move/ })).not.toBeInTheDocument();
});

it("[overhaul-759] a complete graph removal discards Undo even when the normalized item survives and later returns", async () => {
  const plan = mountMovePlan();
  fireEvent.click(await incomingButton());
  const undo = await screen.findByRole("button", { name: /Undo .+-1 move/ });
  await waitFor(() => expect(undo).toBeEnabled());
  const previous = studioApolloClient().readQuery({ query: PlanningGraphDocument, variables: { projectId: "project-1" } })!;
  act(() => plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems, nodes: [] } })));
  await flushInput();
  expect(screen.queryByRole("button", { name: /Undo .+-1 move/ })).not.toBeInTheDocument();
  act(() => plan.change((graph) => ({ ...graph, workItems: previous.workItems })));
  await flushInput();
  expect(screen.queryByRole("button", { name: /Undo .+-1 move/ })).not.toBeInTheDocument();
  expect(plan.writes).toHaveLength(1);
});

it("[overhaul-760] rendered tabs preserve current intent while a cached graph refetch is incomplete, then normalize on completion", async () => {
  let graphRead: Promise<void> | undefined;
  let release = () => {};
  const plan = mountMovePlan({ graphRead: async () => { await graphRead; } });
  await incomingButton();
  graphRead = new Promise<void>((resolve) => { release = resolve; });
  let refresh: Promise<unknown> | undefined;
  act(() => {
    refresh = studioApolloClient().refetchQueries({ include: [PlanningGraphDocument] });
    plan.change((graph) => ({ ...graph, modules: { ...graph.modules, nodes: graph.modules.nodes.filter((module) => module.id !== "alpha") } }));
  });
  await flushInput();
  try {
    expect(screen.getByRole("tab", { name: /Deleted epic, 0 backlog stories/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /No epic/ })).not.toBeInTheDocument();
    expect(usePlanWorkspace.getState().visits.sprint.activeEpicId).toBe("alpha");
  } finally { await act(async () => { release(); await refresh; }); }
  expect(await screen.findByRole("tab", { name: /No epic, 1 backlog stories/ })).toHaveAttribute("aria-selected", "true");
  expect(usePlanWorkspace.getState().visits.sprint.activeEpicId).toBe("__no_epic__");
});

it.each([
  ["incoming", "missing"], ["incoming", "foreign"], ["outgoing", "missing"], ["outgoing", "foreign"],
])("[overhaul-761] %s moves reject a current graph whose owning project is %s", async (direction, owner) => {
  const plan = mountMovePlan({ assignment: direction === "outgoing" ? "sprint" : null });
  const control = direction === "outgoing" ? await screen.findByRole("button", { name: /Return .+-1 to backlog/ }) : await incomingButton();
  expect(control).toBeEnabled();
  clickWithCurrentChange(control, () => plan.change((graph) => ({ ...graph, project: { ...graph.project,
    nodes: owner === "missing" ? [] : [{ ...graph.project.nodes[0], id: "foreign-project" }] } })));
  await flushInput();
  expect(plan.writes).toEqual([]);
});
