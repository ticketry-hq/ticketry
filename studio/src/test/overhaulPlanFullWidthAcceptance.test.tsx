import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { useClientStore } from "../state/clientStore";
import { roadmapAvailabilityFixture } from "./roadmapAvailabilityFixture";

it("[overhaul-528] Plan owns the full-width shell while retained work and the saved Stories/workspace split restore on exit", async () => {
  const f = roadmapAvailabilityFixture();
  f.mount({ sidebar: true });
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(screen.queryByTestId("pane-modules")).toBeNull();
  const details = await screen.findByTestId("details-or-terminal-pane-body");
  const region = screen.getByTestId("module-workspace-region");
  act(() => useClientStore.setState({ panelLayout: [18, 32, 50] }));
  const origin = useClientStore.getState();

  fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
  await screen.findByTestId("plan-sprint");
  expect(screen.queryByTestId("pane-modules")).not.toBeInTheDocument();
  expect(details).toBeInTheDocument();
  expect(details).not.toBeVisible();
  expect(screen.getByTestId("module-workspace-region")).toBe(region);
  expect(useClientStore.getState()).toMatchObject({ panelLayout: [32 / 82 * 100, 50 / 82 * 100] });

  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(details).toBeVisible());
  expect(screen.queryByTestId("pane-modules")).toBeNull();
  expect(screen.getByTestId("details-or-terminal-pane-body")).toBe(details);
  expect(details).toBeVisible();
  expect(screen.getByTestId("module-workspace-region")).toBe(region);
  expect(useClientStore.getState()).toMatchObject({
    selectedModuleId: origin.selectedModuleId,
    selectedTaskId: origin.selectedTaskId,
    panelLayout: [32 / 82 * 100, 50 / 82 * 100],
  });
});
