import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { SuggestionRows } from "../features/sprints/planning/SuggestionRows";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { mountProposal, proposal, reviewProposal } from "./planSuggestionFixture";

it("[overhaul-554] keeps focus in the backlog after accepting its final suggestion from the row", async () => {
  const { holdDecision } = mountProposal();
  await reviewProposal();
  const release = holdDecision();
  const backlog = within(screen.getByTestId("plan-backlog"));
  const accept = backlog.getByRole("button", { name: "Accept Agent wording" });
  accept.focus();
  fireEvent.click(accept, { detail: 0 });
  expect(backlog.getByRole("heading", { name: "Backlog" })).toHaveFocus();
  await act(async () => { release(); });
  await screen.findByText("Selected ticket created-story");
  expect(backlog.getByRole("heading", { name: "Backlog" })).toHaveFocus();
});

it("[overhaul-555] keeps focus in the selected-ticket panel after creating its proposal", async () => {
  mountProposal();
  const pane = await reviewProposal();
  const create = pane.getByRole("button", { name: "Create story" });
  create.focus();
  fireEvent.click(create, { detail: 0 });
  await screen.findByText("Selected ticket created-story");
  expect(pane.getByRole("button", { name: "Close selected ticket" })).toHaveFocus();
});

it("[overhaul-556] returns panel-dismissal focus to the backlog when no suggestion remains", async () => {
  mountProposal();
  const pane = await reviewProposal();
  const dismiss = pane.getByRole("button", { name: "Dismiss" });
  dismiss.focus();
  fireEvent.click(dismiss, { detail: 0 });
  await screen.findByTestId("plan-undo");
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "Selected ticket" })).not.toBeInTheDocument());
  expect(within(screen.getByTestId("plan-backlog")).getByRole("heading", { name: "Backlog" })).toHaveFocus();
});

it("[overhaul-557] returns Close focus to the suggestion being reviewed", async () => {
  mountProposal();
  const pane = await reviewProposal();
  const close = pane.getByRole("button", { name: "Close selected ticket" });
  close.focus();
  fireEvent.click(close, { detail: 0 });
  expect(screen.queryByRole("complementary", { name: "Selected ticket" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "✦ Agent wording" })).toHaveFocus();
});

it("[overhaul-558] returns Escape focus from the proposal input to its suggestion row", async () => {
  mountProposal();
  const pane = await reviewProposal();
  const title = pane.getByRole("textbox", { name: "Title" });
  title.focus();
  fireEvent.keyDown(title, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Selected ticket" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "✦ Agent wording" })).toHaveFocus();
  expect(usePlanWorkspace.getState().active).toBe(true);
});

async function undoEditedDismissal(fromRow: boolean) {
  const { decisions } = mountProposal();
  const pane = await reviewProposal();
  fireEvent.change(pane.getByRole("textbox", { name: "Title" }), { target: { value: "  My carefully edited title  " } });
  fireEvent.click(fromRow
    ? within(screen.getByTestId("plan-backlog")).getByRole("button", { name: "Dismiss Agent wording" })
    : pane.getByRole("button", { name: "Dismiss" }));
  fireEvent.click(await screen.findByTestId("plan-undo"));
  fireEvent.click(await within(screen.getByTestId("plan-backlog")).findByRole("button", { name: "✦ Agent wording" }));
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("  My carefully edited title  ");
  fireEvent.click(screen.getByRole("button", { name: "Create story" }));
  await screen.findByText("Selected ticket created-story");
  expect(decisions).toEqual([
    { id: "proposal", status: "dismissed" },
    { id: "proposal", status: "waiting" },
    { id: "proposal", status: "accepted", proposedName: "My carefully edited title" },
  ]);
}

it("[overhaul-559] restores the exact edited draft after Undo of panel dismissal", async () => {
  await undoEditedDismissal(false);
});

it("[overhaul-560] restores the exact edited draft after Undo of list dismissal", async () => {
  await undoEditedDismissal(true);
});

function WaitingRows() {
  const [rows, setRows] = useState(["First", "Second", "Third"].map((name) => ({ ...proposal, id: name, proposedName: name })));
  const remove = (id: string) => setRows((current) => current.filter((row) => row.id !== id));
  return <section>
    <h2 tabIndex={-1}>Backlog</h2>
    <SuggestionRows suggestions={rows} goals={[]} openItem={null} busy={false} onOpen={() => {}}
      onAccept={(row) => remove(row.id)} onDismiss={(row) => remove(row.id)} onAcceptAll={() => setRows([])} />
  </section>;
}

it("[overhaul-561] focuses the next suggestion, then previous suggestion, then backlog heading as rows disappear", () => {
  render(<WaitingRows />);
  const second = screen.getByRole("button", { name: "Accept Second" });
  second.focus();
  fireEvent.click(second, { detail: 0 });
  expect(screen.getByRole("button", { name: "✦ Third" })).toHaveFocus();
  const third = screen.getByRole("button", { name: "Dismiss Third" });
  third.focus();
  fireEvent.click(third, { detail: 0 });
  expect(screen.getByRole("button", { name: "✦ First" })).toHaveFocus();
  const first = screen.getByRole("button", { name: "Dismiss First" });
  first.focus();
  fireEvent.click(first, { detail: 0 });
  expect(screen.getByRole("heading", { name: "Backlog" })).toHaveFocus();
});

it("[overhaul-562] keeps a delayed acceptance from stealing focus after the planner moves elsewhere", async () => {
  const { holdDecision } = mountProposal();
  const pane = await reviewProposal();
  const release = holdDecision();
  const create = pane.getByRole("button", { name: "Create story" });
  create.focus();
  fireEvent.click(create, { detail: 0 });
  expect(pane.getByRole("button", { name: "Close selected ticket" })).toHaveFocus();
  const addEpic = screen.getByRole("button", { name: "Add epic" });
  addEpic.focus();
  await act(async () => { release(); });
  await screen.findByText("Selected ticket created-story");
  expect(addEpic).toHaveFocus();
});

it("[overhaul-563] returns Add all focus to the backlog heading after the batch disappears", () => {
  render(<WaitingRows />);
  const addAll = screen.getByRole("button", { name: "Add all" });
  addAll.focus();
  fireEvent.click(addAll, { detail: 0 });
  expect(screen.queryByRole("button", { name: "Add all" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Backlog" })).toHaveFocus();
});

it("[overhaul-564] keeps banner-acceptance focus in the existing story panel", async () => {
  mountProposal({ existing: true, fullDetail: true });
  fireEvent.click(await screen.findByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: /Module 1, .*waiting suggestions/ }));
  fireEvent.click(await screen.findByRole("button", { name: "✦ My release story" }));
  const pane = within(await screen.findByRole("complementary", { name: "Selected ticket" }));
  const accept = pane.getByRole("button", { name: "Add to sprint" });
  accept.focus();
  fireEvent.click(accept, { detail: 0 });
  await waitFor(() => expect(pane.queryByRole("note")).not.toBeInTheDocument());
  expect(await pane.findByTestId("details-document")).toHaveTextContent("My release story");
  expect(pane.getByRole("button", { name: "Close selected ticket" })).toHaveFocus();
});

it("[overhaul-565] leaves focus elsewhere when a pointer decision removes an unfocused row", () => {
  render(<><button>Other task</button><WaitingRows /></>);
  const elsewhere = screen.getByRole("button", { name: "Other task" });
  elsewhere.focus();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss Second" }), { detail: 1 });
  expect(screen.queryByRole("button", { name: "✦ Second" })).not.toBeInTheDocument();
  expect(elsewhere).toHaveFocus();
});

it("[overhaul-566] keeps the accepted proposal draft until its real ticket's module has loaded", async () => {
  const { holdModule } = mountProposal({ fullDetail: true, freshProposal: true });
  const pane = await reviewProposal();
  const release = holdModule("module-1");
  const create = pane.getByRole("button", { name: "Create story" });
  create.focus();
  fireEvent.click(create, { detail: 0 });
  await waitFor(() => expect(usePlanWorkspace.getState().pendingOpenItem).toBe("created-story"));
  expect(pane.getByRole("textbox", { name: "Title" })).toHaveValue("Agent wording");
  expect(pane.queryByTestId("details-document")).not.toBeInTheDocument();
  await act(async () => { release(); });
  expect(await pane.findByTestId("details-document")).toHaveTextContent("Agent wording");
  expect(pane.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  expect(pane.getByRole("button", { name: "Close selected ticket" })).toHaveFocus();
});
