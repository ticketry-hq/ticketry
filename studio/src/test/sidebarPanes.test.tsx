import { render, screen } from "@testing-library/react";
import { PanelGroup } from "react-resizable-panels";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { describe, expect, it } from "vitest";
import { StudioSidebar } from "../app/shell/sidebar/StudioSidebar";
import {
  DEFAULT_PANEL_LAYOUT,
  mergeOuterPanelLayout,
  outerPanelLayout,
} from "../app/shell/layout/layoutMath";
import { visiblePaneOrder } from "../state/clientStore";

describe("sidebar panes", () => {
  it("holds the installation project's modules and offers no project chooser", () => {
    render(
      <StudioApolloProvider>
        <PanelGroup direction="horizontal">
          <StudioSidebar layout={DEFAULT_PANEL_LAYOUT} />
        </PanelGroup>
      </StudioApolloProvider>,
    );

    expect(screen.getByTestId("pane-modules")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-projects")).not.toBeInTheDocument();
  });

  it("gives a hidden sidebar the full outer layout without rewriting dormant sizes", () => {
    expect(outerPanelLayout(DEFAULT_PANEL_LAYOUT, false)).toEqual([100]);
    expect(mergeOuterPanelLayout(DEFAULT_PANEL_LAYOUT, [100])).toBeNull();
  });

  it("splits the outer layout between the modules pane and the work area", () => {
    const [modules, workArea] = outerPanelLayout(DEFAULT_PANEL_LAYOUT, true);

    expect(modules + workArea).toBeCloseTo(100);
    expect(modules).toBeLessThan(workArea);
  });

  it("omits the sidebar from traversal while it is hidden", () => {
    expect(visiblePaneOrder(false, true)).toEqual([
      "tasks",
      "details-or-terminal",
    ]);
  });

  it("traverses modules, tasks, then the workspace while the sidebar shows", () => {
    expect(visiblePaneOrder(true, true)).toEqual([
      "modules",
      "tasks",
      "details-or-terminal",
    ]);
  });

  it("omits the modules pane until a project is selected", () => {
    expect(visiblePaneOrder(true, false)).toEqual([
      "tasks",
      "details-or-terminal",
    ]);
  });
});
