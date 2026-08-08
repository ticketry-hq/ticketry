import { render, screen } from "@testing-library/react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { describe, expect, it } from "vitest";
import { PaneResizeHandle } from "../app/shell/layout/PaneResizeHandle";

describe("overhaul acceptance — resizable application layout", () => {
  it("[overhaul-18] exposes the draggable pane boundary as a named separator", () => {
    render(
      <div style={{ width: 1_000, height: 600 }}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={40}>Stories</Panel>
          <PaneResizeHandle />
          <Panel defaultSize={60}>Workspace</Panel>
        </PanelGroup>
      </div>,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize adjacent panes",
    });
    expect(separator).toHaveAttribute("data-testid", "pane-resize-handle");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
  });
});
