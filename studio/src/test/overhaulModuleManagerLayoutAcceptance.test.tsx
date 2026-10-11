import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { useClientStore } from "../state/clientStore";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { readPanelLayout } from "../state/persistence";

it("[overhaul-655] the footer manager replaces the sidebar without a panel or resize gutter", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, sidebar: true, selectedTaskId: null });
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(screen.queryByTestId("pane-modules")).toBeNull();
  expect(screen.queryByTestId("modules-pane-toggle")).toBeNull();
  expect(screen.getByTestId("module-workspace-region").closest("[data-panel-group]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toBeVisible();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByTestId("module-workspace-region").closest("[data-panel-group]")).toBeNull();
});

it("migrates saved sidebar width into the existing Stories/workspace ratio and retains it across manager takeover", async () => {
  localStorage.setItem("studio.panelLayout:v1", JSON.stringify([20, 32, 48]));
  useClientStore.setState({ panelLayout: readPanelLayout() });
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, sidebar: true, selectedTaskId: null });
  await screen.findByRole("tab", { name: "Roadmap" });
  const region = screen.getByTestId("module-workspace-region");
  const panels = region.querySelector('[data-panel-group-direction="horizontal"]')!.querySelectorAll(':scope > [data-panel]');
  expect(panels[0]).toHaveAttribute("data-panel-size", "40.0");
  expect(panels[1]).toHaveAttribute("data-panel-size", "60.0");
  await waitFor(() => expect(JSON.parse(localStorage.getItem("studio.panelLayout:v1")!)).toEqual([40, 60]));
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(panels[0]).toHaveAttribute("data-panel-size", "40.0");
  expect(panels[1]).toHaveAttribute("data-panel-size", "60.0");
});
