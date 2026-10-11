import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { mountProposal, reviewProposal } from "./planSuggestionFixture";

describe("Recovered proposal review", () => {
  it("[overhaul-547] requires a nonblank proposal title before either detail or row acceptance", async () => {
    const { decisions } = mountProposal();
    const pane = await reviewProposal();
    fireEvent.change(pane.getByRole("textbox", { name: "Title" }), { target: { value: "   " } });
    expect(pane.getByRole("button", { name: "Create story" })).toBeDisabled();
    fireEvent.click(within(screen.getByTestId("plan-backlog")).getByRole("button", { name: "Accept Agent wording" }));
    expect(decisions).toEqual([]);
    expect(pane.getByRole("textbox", { name: "Title" })).toHaveValue("   ");
    fireEvent.change(pane.getByRole("textbox", { name: "Title" }), { target: { value: "My release story" } });
    expect(pane.getByRole("button", { name: "Create story" })).toBeEnabled();
  });
  it("[overhaul-548] accepts an edited proposal in one write and switches to its real ticket", async () => {
    const { decisions } = mountProposal();
    const pane = await reviewProposal();
    expect(pane.getByText("G1. Make release planning easier")).toBeVisible();
    expect(pane.getByLabelText("Epic")).toHaveValue("Module 1");
    expect(pane.getByLabelText("Sprint")).toHaveValue("October release");
    fireEvent.change(pane.getByRole("textbox", { name: "Title" }), { target: { value: "  My release story  " } });
    expect(decisions).toEqual([]);
    fireEvent.click(pane.getByRole("button", { name: "Create story" }));
    await waitFor(() => expect(screen.getByText("Selected ticket created-story")).toBeVisible());
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(screen.queryByText("Helps people plan a release")).not.toBeInTheDocument();
    expect(decisions).toEqual([{ id: "proposal", status: "accepted", proposedName: "My release story" }]);
    await waitFor(() => expect(usePlanWorkspace.getState().openItem).toBe("created-story"));
  });
  it("[overhaul-550] retries the captured edited proposal title and retries a failed Undo without creating another story", async () => {
    const { decisions, failNextDecision } = mountProposal();
    const pane = await reviewProposal();
    fireEvent.change(pane.getByRole("textbox", { name: "Title" }), { target: { value: "My release story" } });
    failNextDecision();
    fireEvent.click(pane.getByRole("button", { name: "Create story" }));
    const feedback = within(screen.getByTestId("plan-feedback"));
    await feedback.findByRole("button", { name: /Retry/ });
    fireEvent.change(pane.getByRole("textbox", { name: "Title" }), { target: { value: "A newer draft" } });
    fireEvent.click(feedback.getByRole("button", { name: /Retry/ }));
    await screen.findByText("Selected ticket created-story");
    failNextDecision();
    fireEvent.click(await screen.findByTestId("plan-undo"));
    fireEvent.click(await feedback.findByRole("button", { name: /Retry/ }));
    const backlog = within(screen.getByTestId("plan-backlog"));
    expect(await backlog.findByRole("button", { name: "✦ My release story" })).toBeVisible();
    await waitFor(() => expect(decisions).toHaveLength(4));
    expect(decisions).toEqual([
      { id: "proposal", status: "accepted", proposedName: "My release story" },
      { id: "proposal", status: "accepted", proposedName: "My release story" },
      { id: "proposal", status: "waiting" },
      { id: "proposal", status: "waiting" },
    ]);
  });
  it("[overhaul-551] keeps the accepted proposal's goal chip on its planned story until Undo restores the suggestion", async () => {
    mountProposal();
    const pane = await reviewProposal();
    fireEvent.change(pane.getByRole("textbox", { name: "Title" }), { target: { value: "My release story" } });
    fireEvent.click(pane.getByRole("button", { name: "Create story" }));
    const planned = within(screen.getByTestId("plan-sprint-items"));
    expect(await planned.findByText("My release story")).toBeVisible();
    const chip = planned.getByText("G1");
    expect(chip).toBeVisible();
    expect(chip).toHaveAttribute("title", "Make release planning easier");
    expect(planned.queryByText("✦ My release story")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("plan-undo"));
    const backlog = within(screen.getByTestId("plan-backlog"));
    expect(await backlog.findByRole("button", { name: "✦ My release story" })).toBeVisible();
    expect(backlog.getByText("G1")).toHaveAttribute("title", "Make release planning easier");
    await waitFor(() => expect(planned.queryByText("G1")).not.toBeInTheDocument());
  });
  it("[overhaul-552] opening a proposal invalidates an older pending story open", async () => {
    const { holdModule } = mountProposal({ newerStory: true });
    await reviewProposal();
    const releaseModule = holdModule();
    fireEvent.click(within(screen.getByTestId("plan-sprint-items")).getByRole("button", { name: /A different story/ }));
    await waitFor(() => expect(usePlanWorkspace.getState().pendingOpenItem).toBe("newer-story"));
    fireEvent.click(within(screen.getByTestId("plan-backlog")).getByRole("button", { name: "✦ Agent wording" }));
    expect(usePlanWorkspace.getState().pendingOpenItem).toBeNull();
    await act(async () => { releaseModule(); });
    expect(within(screen.getByRole("complementary", { name: "Selected ticket" })).getByRole("textbox", { name: "Title" })).toHaveValue("Agent wording");
    expect(screen.queryByText("Selected ticket newer-story")).not.toBeInTheDocument();
  });
  it("[overhaul-553] preserves a newer pending story selection after a delayed proposal acceptance", async () => {
    const { decisions, holdDecision, holdModule } = mountProposal({ newerStory: true });
    const pane = await reviewProposal();
    const releaseDecision = holdDecision();
    const releaseModule = holdModule();
    fireEvent.click(pane.getByRole("button", { name: "Create story" }));
    await waitFor(() => expect(decisions).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId("plan-sprint-items")).getByRole("button", { name: /A different story/ }));
    await waitFor(() => expect(usePlanWorkspace.getState().pendingOpenItem).toBe("newer-story"));
    await act(async () => { releaseDecision(); });
    await screen.findByTestId("plan-undo");
    expect(usePlanWorkspace.getState().pendingOpenItem).toBe("newer-story");
    await act(async () => { releaseModule(); });
    expect(await screen.findByText("Selected ticket newer-story")).toBeVisible();
    expect(screen.queryByText("Selected ticket created-story")).not.toBeInTheDocument();
  });
});
