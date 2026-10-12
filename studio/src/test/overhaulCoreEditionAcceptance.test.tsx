import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { openPlanWorkspace, usePlanWorkspace } from "../features/sprints";
import { closePlanSprint, leavePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { useClientStore } from "../state/clientStore";
import { useTerminalStore } from "../features/agents/terminal";
import { closeActiveWorkspaceTerminal } from "../app/navigation/sharedNavigation";

it("[overhaul-534] core edition restores retained planning while Plan exclusively owns navigation", async () => {
  const f = editionAcceptanceFixture({ withDocument: true });
  f.mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  const design = await screen.findByRole("tab", { name: "DESIGN" });
  fireEvent.click(design);
  const records = JSON.stringify([f.graph, f.goals, f.suggestions, f.presentations]);
  act(() => openPlanWorkspace("sprint-25"));
  expect(await screen.findByTestId("plan-sprint")).toBeVisible();
  expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("1 goal")).toHaveAttribute("title", "G1. Ship retained goal");
  // Hidden module work cannot receive close commands while visible Plan owns the keys.
  fireEvent.keyDown(document.body, { key: "w", metaKey: true });
  expect(useClientStore.getState().workspaces["roadmap-24"].closedDocIds).not.toContain("design");
  act(f.seedTerminal);
  expect(closeActiveWorkspaceTerminal("run-retained")).toBe(false);
  expect(useTerminalStore.getState().sessionByRun["run-retained"]).toBe("viewer-retained");
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "0.2.0, 0 backlog stories, 1 waiting suggestions" }));
  expect(await within(screen.getByTestId("plan-backlog")).findByRole("button", { name: "✦ Release next story" })).toBeVisible();
  act(closePlanSprint);
  expect(await screen.findByRole("heading", { name: "Sprints" })).toBeVisible();
  fireEvent.click(within(screen.getByTestId("sprint-card-sprint-24")).getByRole("button", { name: "Complete" }));
  expect(await screen.findByRole("dialog", { name: "Complete Sprint 24" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  act(leavePlanWorkspace);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true"));
  expect(usePlanWorkspace.getState().active).toBe(false);
  expect(JSON.stringify([f.graph, f.goals, f.suggestions, f.presentations])).toBe(records);
  expect(f.calls.filter(({ operation }) => /^(Create|Update|Delete)(Sprint|Planning)|UpdateWorkTrackerModulePresentation|UpdateTerminalSession/.test(operation))).toEqual([]);
});

it("core shell marks the document root with its compiled edition for e2e", async () => {
  delete document.documentElement.dataset.ticketryEdition;
  editionAcceptanceFixture().mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(document.documentElement).toHaveAttribute("data-ticketry-edition", "core");
});
