import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";

const planningReads = (calls: Array<{ operation: string }>) =>
  calls.filter(({ operation }) => ["PlanningGraph", "SprintGoals", "SprintSuggestions", "SprintSuggestionExecution"].includes(operation));

it("Pocock Module Manager details omit sprint membership", async () => {
  const f = editionAcceptanceFixture();
  f.mount({ selectedTaskId: null });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect bugs" }));
  const detail = screen.getByRole("region", { name: "Module details: bugs" });
  expect(within(detail).getByText("Local profile folder")).toBeVisible();
  expect(within(detail).getByText("Agents and lifecycle")).toBeVisible();
  expect(within(detail).queryByText("Sprint membership")).toBeNull();
  expect(within(detail).queryByText(/sprint membership/i)).toBeNull();
});

it("Pocock ignores sprint facts from the status stream", async () => {
  const f = editionAcceptanceFixture();
  let deliver: ((encoded: string) => void) | undefined;
  f.mount({ onGraphQlSubscribe: async (_id, request, onEvent) => {
    if (JSON.parse(request).operationName === "RunStatusStream") deliver = onEvent;
    return '{"type":"accepted"}';
  } });
  await screen.findByRole("tab", { name: "Roadmap" });
  await waitFor(() => expect(deliver).toBeDefined());
  const send = (frame: unknown) => deliver!(JSON.stringify({ type: "next", payload: { data: { run_status_stream: frame } } }));
  act(() => send({ __typename: "RunStatusSnapshot", project_id: "project-1", cursor: 100,
    at: "2026-10-09T10:00:00Z", runs: [], automation_attempts: [] }));
  const before = planningReads(f.calls).length;
  act(() => send({ __typename: "RunStatusEvent", cursor: 101, event_id: "sprint-event-101",
    project_id: "project-1", event_kind: "sprint.changed", payload_version: 1,
    subject_kind: "sprint", subject_id: "sprint-25", agent_run_id: null,
    automation_attempt_id: null, work_item_id: null,
    payload: { projectId: "project-1", sprintId: "sprint-25", changeKind: "reordered", rank: "a005", revision: 5 },
    committed_at: "2026-10-09T10:00:00Z" }));
  // The sprint invalidator batches facts for 50ms; wait well past one batch.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  expect(planningReads(f.calls).slice(before)).toEqual([]);
  expect(screen.queryByTestId("workspace-tab-plan")).toBeNull();
});

it("Pocock shell marks the document root with its compiled edition for e2e", async () => {
  delete document.documentElement.dataset.ticketryEdition;
  editionAcceptanceFixture().mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(document.documentElement).toHaveAttribute("data-ticketry-edition", "pocock");
});
