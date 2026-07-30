import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "../app/studio/layout/Sidebar";
import {
  DEFAULT_PANEL_LAYOUT,
  mergeOuterPanelLayout,
  outerPanelLayout,
} from "../app/studio/layout/layoutMath";
import { sidebarPaneComposition } from "../features/studio/stores/configStore";
import { visiblePaneOrder } from "../features/studio/stores/uiStore";

describe("sidebar pane composition", () => {
  it("preserves both existing Projects feature shapes", () => {
    expect(sidebarPaneComposition(true)).toBe("projects-and-modules");
    expect(sidebarPaneComposition(false)).toBe("modules");
  });

  it("gives an absent sidebar the full outer layout without rewriting dormant sizes", () => {
    expect(outerPanelLayout(DEFAULT_PANEL_LAYOUT, true, "absent")).toEqual([
      100,
    ]);
    expect(
      mergeOuterPanelLayout(DEFAULT_PANEL_LAYOUT, [100], "absent"),
    ).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(
      mergeOuterPanelLayout(DEFAULT_PANEL_LAYOUT, [50, 50], "absent"),
    ).toBeNull();
  });

  it("renders no sidebar panes for the absent shape", () => {
    render(
      <Sidebar
        layout={DEFAULT_PANEL_LAYOUT}
        paneComposition="absent"
      />,
    );

    expect(screen.queryByTestId("pane-projects")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pane-modules")).not.toBeInTheDocument();
  });

  it("omits sidebar panes from traversal for the absent shape", () => {
    expect(visiblePaneOrder(true, true, "absent")).toEqual([
      "tasks",
      "details-or-terminal",
    ]);
  });
});
