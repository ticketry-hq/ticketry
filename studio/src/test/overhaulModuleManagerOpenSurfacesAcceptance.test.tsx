import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";

async function mountShell() {
  editionAcceptanceFixture().mount({ selectedTaskId: null });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
}

async function enterPlan() {
  const planTab = screen.getByTestId("workspace-tab-plan");
  fireEvent.click(planTab);
  await waitFor(() => expect(planTab).toHaveAttribute("aria-selected", "true"));
}

async function enterChanges() {
  fireEvent.click(screen.getByTestId("workspace-tab-changes"));
  await screen.findByTestId("independent-changes-workspace");
}

function openManager() {
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  return screen.getByRole("region", { name: "Module Manager" });
}

async function expectModuleWorkspace(name: string) {
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByTestId("workspace-tab-plan")).toHaveAttribute("aria-selected", "false");
  expect(screen.getByTestId("workspace-tab-changes")).toHaveAttribute("aria-selected", "false");
  expect(screen.queryByTestId("independent-changes-workspace")).toBeNull();
  await waitFor(() => expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true"));
}

it("[CODING-2884] row Open leaves Plan and selects the chosen module without Plan restoring its origin", async () => {
  await mountShell();
  await enterPlan();
  const manager = openManager();
  const open = within(manager).getByRole("button", { name: "Open 0.2.0" });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  await expectModuleWorkspace("0.2.0");
  await enterPlan();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await expectModuleWorkspace("0.2.0");
});

it("[CODING-2884] row Open of the currently selected module leaves Changes", async () => {
  await mountShell();
  await enterChanges();
  const manager = openManager();
  const open = within(manager).getByRole("button", { name: "Open Roadmap" });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  await expectModuleWorkspace("Roadmap");
});

it("[CODING-2884] detail Open leaves Plan and selects the inspected module", async () => {
  await mountShell();
  await enterPlan();
  const manager = openManager();
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect 0.2.0" }));
  const detail = screen.getByRole("region", { name: "Module details: 0.2.0" });
  const open = within(detail).getByRole("button", { name: "Open 0.2.0" });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  await expectModuleWorkspace("0.2.0");
});

it("[CODING-2884] Enter Open leaves Plan and selects the focused module", async () => {
  await mountShell();
  await enterPlan();
  const manager = openManager();
  const inspect = within(manager).getByRole("button", { name: "Inspect 0.2.0" });
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Open 0.2.0" })).toBeEnabled());
  inspect.focus();
  fireEvent.keyDown(inspect, { key: "Enter" });
  await expectModuleWorkspace("0.2.0");
});

it("[CODING-2884] Restore keeps Plan active while the manager stays open", async () => {
  await mountShell();
  await enterPlan();
  const manager = openManager();
  const restore = within(manager).getByRole("button", { name: "Restore 0.2.0" });
  await waitFor(() => expect(restore).toBeEnabled());
  fireEvent.click(restore);
  await waitFor(() => expect(within(manager).queryByRole("button", { name: "Restore 0.2.0" })).toBeNull());
  expect(screen.getByRole("region", { name: "Module Manager" })).toBe(manager);
  expect(screen.getByTestId("workspace-tab-plan")).toHaveAttribute("aria-selected", "true");
});
