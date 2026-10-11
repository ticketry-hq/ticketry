import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { closePlanSprint, openPlanSprint } from "../features/sprints/planWorkspaceState";
import { mountProposal, reviewProposal } from "./planSuggestionFixture";

it("[overhaul-762] saved proposal survives failed refresh and Retry refresh keeps its committed Story identity", async () => {
  const fixture = mountProposal({ freshProposal: true });
  const detail = await reviewProposal();
  fixture.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const retry = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(screen.getByTestId("plan-feedback")).toHaveTextContent("Suggestion saved, but the view could not refresh");
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo Agent wording suggestion" })).toBeInTheDocument();
  const reads = { ...fixture.reads };
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 1, SprintSuggestions: reads.SprintSuggestions + 1, SprintSuggestionExecution: reads.SprintSuggestionExecution + 1 });
  expect(await screen.findByText("Selected ticket created-story")).toBeVisible();
});

it("[overhaul-763] a definite rejection retains the edited proposal and retries only its rejected write", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fireEvent.change(detail.getByRole("textbox", { name: "Title" }), { target: { value: "  Edited release  " } });
  fixture.failNextDecision();
  const reads = { ...fixture.reads };
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const retry = await screen.findByRole("button", { name: "Retry accepting Agent wording suggestion" });
  expect(detail.getByRole("textbox", { name: "Title" })).toHaveValue("  Edited release  ");
  expect(fixture.reads).toEqual(reads);
  fireEvent.click(retry);
  await screen.findByText("Selected ticket created-story");
  expect(fixture.decisions).toEqual([
    { id: "proposal", status: "accepted", proposedName: "Edited release" },
    { id: "proposal", status: "accepted", proposedName: "Edited release" },
  ]);
});

it("[overhaul-764] a lost acceptance response inspects authoritative suggestion and Story before retaining success", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("after");
  const reads = { ...fixture.reads };
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  await screen.findByRole("button", { name: "Undo Agent wording suggestion" });
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 1, SprintSuggestions: reads.SprintSuggestions + 1, SprintSuggestionExecution: reads.SprintSuggestionExecution + 1 });
  expect(await screen.findByText("Selected ticket created-story")).toBeVisible();
});

it("[overhaul-765] an uncommitted transport outcome is inspected before an explicit proposal Retry", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("before");
  const reads = { ...fixture.reads };
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const retry = await screen.findByRole("button", { name: "Retry accepting Agent wording suggestion" });
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 1, SprintSuggestions: reads.SprintSuggestions + 1, SprintSuggestionExecution: reads.SprintSuggestionExecution + 1 });
  expect(fixture.decisions).toHaveLength(1);
  fireEvent.click(retry);
  await screen.findByText("Selected ticket created-story");
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }, { id: "proposal", status: "accepted" }]);
});

it("[overhaul-766] failed inspection remains read-only recovery and never blindly creates a second proposal", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("after");
  fixture.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const inspect = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(inspect).toHaveTextContent("Inspect suggestion");
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
  expect(detail.getByRole("button", { name: "Create story" })).toBeDisabled();
  const reads = { ...fixture.reads };
  fixture.failNextRefresh();
  fireEvent.click(inspect);
  await waitFor(() => expect(inspect).toBeEnabled());
  expect(fixture.decisions).toHaveLength(1);
  fireEvent.click(inspect);
  await screen.findByRole("button", { name: "Undo Agent wording suggestion" });
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 2, SprintSuggestions: reads.SprintSuggestions + 2, SprintSuggestionExecution: reads.SprintSuggestionExecution + 2 });
  expect(await screen.findByText("Selected ticket created-story")).toBeVisible();
});

it("[overhaul-767] incomplete owning graph cannot authorize repeating an unknown proposal acceptance", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("before");
  fixture.omitProject();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const inspect = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(inspect).toHaveTextContent("Inspect suggestion");
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
  expect(fixture.decisions).toHaveLength(1);
  fixture.omitProject(false);
  fireEvent.click(inspect);
  const retry = await screen.findByRole("button", { name: /^Retry accepting/ });
  expect(retry).toBeEnabled();
  expect(fixture.decisions).toHaveLength(1);
});

it("[overhaul-768] reopening an unresolved visit keeps read recovery accessible before any repeat decision", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("before");
  fixture.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  await screen.findByRole("button", { name: "Retry suggestion refresh" });
  act(() => { closePlanSprint(); openPlanSprint("release"); });
  const inspect = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(inspect).toHaveTextContent("Inspect suggestion");
  expect(screen.getByRole("button", { name: "Accept Agent wording" })).toBeDisabled();
  fireEvent.click(inspect);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Accept Agent wording" })).toBeEnabled();
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
});

it("[overhaul-769] bulk acceptance stops after its first committed decision fails refresh and never replays it", async () => {
  const fixture = mountProposal({ secondProposal: true });
  fireEvent.click(await screen.findByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: "Module 1, 0 backlog stories, 2 waiting suggestions" }));
  const addAll = screen.getByRole("button", { name: "Add all" });
  addAll.focus();
  fixture.failNextRefresh();
  const reads = { ...fixture.reads };
  fireEvent.click(addAll, { detail: 0 });
  const retry = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(screen.getByRole("button", { name: "Accept Second proposal" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Backlog" })).toHaveFocus();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 2, SprintSuggestions: reads.SprintSuggestions + 2, SprintSuggestionExecution: reads.SprintSuggestionExecution + 2 });
});

it("[overhaul-770] inherited recovery cannot inspect or repeat while the old visit decision is still saving", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  const release = fixture.holdDecision();
  fixture.loseNextDecision("before");
  fixture.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  await waitFor(() => expect(fixture.decisions).toHaveLength(1));
  act(() => { closePlanSprint(); openPlanSprint("release"); });
  const inspect = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(inspect).toBeDisabled();
  const reads = { ...fixture.reads };
  fireEvent.click(inspect);
  expect(fixture.reads).toEqual(reads);
  await act(async () => { release(); });
  await waitFor(() => expect(inspect).toBeEnabled());
  expect(screen.getByRole("button", { name: "Accept Agent wording" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
  fireEvent.click(inspect);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Accept Agent wording" })).toBeEnabled();
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
});

it("[overhaul-771] dismissed suggestion read recovery retains Undo and its edited draft without repeating dismissal", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fireEvent.change(detail.getByRole("textbox", { name: "Title" }), { target: { value: "  Carefully edited draft  " } });
  fixture.failNextRefresh();
  const dismiss = detail.getByRole("button", { name: "Dismiss" });
  dismiss.focus();
  fireEvent.click(dismiss, { detail: 0 });
  const retry = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(screen.getByRole("heading", { name: "Backlog" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Undo Agent wording suggestion" })).toBeEnabled();
  const reads = { ...fixture.reads };
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "dismissed" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 1, SprintSuggestions: reads.SprintSuggestions + 1, SprintSuggestionExecution: reads.SprintSuggestionExecution + 1 });
  fireEvent.click(screen.getByRole("button", { name: "Undo Agent wording suggestion" }));
  fireEvent.click(await screen.findByRole("button", { name: "✦ Agent wording" }));
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("  Carefully edited draft  ");
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "dismissed" }, { id: "proposal", status: "waiting" }]);
});

it("[overhaul-772] confirmed Undo followed by failed reads is recovered with reads without repeating either write", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const undo = await screen.findByRole("button", { name: "Undo Agent wording suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  fixture.failNextRefresh();
  fireEvent.click(undo);
  const retry = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(screen.queryByRole("button", { name: /^Retry undoing/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Undo / })).not.toBeInTheDocument();
  const reads = { ...fixture.reads };
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }, { id: "proposal", status: "waiting" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 1, SprintSuggestions: reads.SprintSuggestions + 1, SprintSuggestionExecution: reads.SprintSuggestionExecution + 1 });
  expect(await screen.findByRole("button", { name: "Accept Agent wording" })).toBeEnabled();
  expect(screen.getByText("Selected ticket created-story")).toBeVisible();
});

it("[overhaul-773] an ambiguous server error after commitment is inspected rather than replayed as a rejection", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("afterServer");
  const reads = { ...fixture.reads };
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  await screen.findByRole("button", { name: "Undo Agent wording suggestion" });
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 1, SprintSuggestions: reads.SprintSuggestions + 1, SprintSuggestionExecution: reads.SprintSuggestionExecution + 1 });
});

it("[overhaul-774] rejected Undo preserves the committed decision's outstanding read recovery", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  await screen.findByRole("button", { name: "Retry suggestion refresh" });
  const undo = screen.getByRole("button", { name: "Undo Agent wording suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  fixture.failNextDecision();
  fireEvent.click(undo);
  await screen.findByRole("button", { name: "Retry undoing Agent wording suggestion" });
  const retryRead = screen.getByRole("button", { name: "Retry suggestion refresh" });
  expect(screen.getByRole("button", { name: "Undo Agent wording suggestion" })).toBeInTheDocument();
  fireEvent.click(retryRead);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }, { id: "proposal", status: "waiting" }]);
});

it("[overhaul-775] Retry refresh preserves a newer selected Story and focused epic instead of following the older proposal", async () => {
  const fixture = mountProposal({ newerStory: true });
  const detail = await reviewProposal();
  fixture.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const retry = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: "Module 2, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: /A different story/ }));
  await screen.findByText("Selected ticket newer-story");
  const epic = screen.getByRole("tab", { name: /^Module 2,/ });
  epic.focus();
  const reads = { ...fixture.reads };
  fireEvent.click(retry, { detail: 1 });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  expect(screen.getByText("Selected ticket newer-story")).toBeVisible();
  expect(epic).toHaveFocus();
  expect(epic).toHaveAttribute("aria-selected", "true");
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 1, SprintSuggestions: reads.SprintSuggestions + 1, SprintSuggestionExecution: reads.SprintSuggestionExecution + 1 });
});

it("[overhaul-776] an old visit's held recovery read blocks newer inspection and decisions until authoritative recovery settles", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("before");
  fixture.failNextRefresh();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const retry = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  const release = fixture.holdSuggestions();
  fireEvent.click(retry);
  await waitFor(() => expect(retry).toBeDisabled());
  const reads = { ...fixture.reads };
  act(() => { closePlanSprint(); openPlanSprint("release"); });
  const inspect = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(inspect).toBeDisabled();
  expect(screen.getByRole("button", { name: "Accept Agent wording" })).toBeDisabled();
  fireEvent.click(inspect);
  expect(fixture.reads).toEqual(reads);
  await act(async () => { release(); });
  await waitFor(() => expect(inspect).toBeEnabled());
  fireEvent.click(inspect);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry suggestion refresh" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Accept Agent wording" }));
  await screen.findByRole("button", { name: "Undo Agent wording suggestion" });
  expect(screen.queryByRole("button", { name: "Accept Agent wording" })).not.toBeInTheDocument();
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }, { id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 2, SprintSuggestions: reads.SprintSuggestions + 2, SprintSuggestionExecution: reads.SprintSuggestionExecution + 2 });
});

it("[overhaul-777] inconsistent authoritative suggestion and Story membership remains inspection recovery without replay", async () => {
  const fixture = mountProposal();
  const detail = await reviewProposal();
  fixture.loseNextDecision("after");
  fixture.inconsistentSuggestionMembership();
  const reads = { ...fixture.reads };
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const inspect = await screen.findByRole("button", { name: "Retry suggestion refresh" });
  expect(inspect).toHaveTextContent("Inspect suggestion");
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
  fixture.inconsistentSuggestionMembership(false);
  fireEvent.click(inspect);
  await screen.findByRole("button", { name: "Undo Agent wording suggestion" });
  expect(fixture.decisions).toEqual([{ id: "proposal", status: "accepted" }]);
  expect(fixture.reads).toEqual({ PlanningGraph: reads.PlanningGraph + 2, SprintSuggestions: reads.SprintSuggestions + 2, SprintSuggestionExecution: reads.SprintSuggestionExecution + 2 });
});
