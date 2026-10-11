import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { mountProposal } from "./planSuggestionFixture";

it("[overhaul-813] Add all retains an Undone edited proposal when a graph refetch starts mid-batch", async () => {
  const plan = mountProposal({ freshProposal: true, bulkStories: true });
  fireEvent.click(await screen.findByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: "Module 1, 2 backlog stories, 3 waiting suggestions" }));
  fireEvent.click(await screen.findByRole("button", { name: "✦ Agent wording" }));
  const detail = within(screen.getByRole("complementary", { name: "Selected ticket" }));
  fireEvent.change(detail.getByRole("textbox", { name: "Title" }), { target: { value: "  Edited release  " } });
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  const undo = await screen.findByRole("button", { name: "Undo Edited release suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  fireEvent.click(undo);
  const restored = await screen.findByRole("button", { name: "Accept Edited release" });
  await waitFor(() => expect(restored).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Close selected ticket" }));
  // Initial acceptance and Undo are writes 1/2. The second batch decision is
  // write 4; its successful refresh also starts a held background graph read.
  const release = plan.holdBackgroundAfterDecision(4);
  try {
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));
    await waitFor(() => expect(plan.decisions).toEqual([
      { id: "proposal", status: "accepted", proposedName: "Edited release" },
      { id: "proposal", status: "waiting" },
      { id: "existing-0", status: "accepted" },
      { id: "existing-1", status: "accepted" },
      { id: "proposal", status: "accepted" },
    ]));
  } finally { await act(async () => { await release(); }); }
  const planned = within(screen.getByTestId("plan-sprint-items"));
  await waitFor(() => expect(planned.getByText("Edited release")).toBeVisible());
  expect(planned.getByText("First existing")).toBeVisible();
  expect(planned.getByText("Second existing")).toBeVisible();
  expect(planned.getAllByText("G1")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Add all" })).not.toBeInTheDocument();
});
