import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PaneShell } from "../app/shell/PaneShell";
import { seedConfig } from "../features/studio/stores/configStore";
import { useClientStore } from "../state/clientStore";

function renderPanePair() {
  const { container } = render(
    <>
      <PaneShell title="Stories" pane="tasks" />
      <PaneShell title="Workspace" pane="details-or-terminal" />
    </>,
  );

  return {
    stories: container.querySelector('[data-pane="tasks"]'),
    workspace: container.querySelector('[data-pane="details-or-terminal"]')!,
  };
}

describe("PaneShell", () => {
  beforeEach(() => {
    seedConfig({
      features: { sidebar: true, projects: true },
    });
    useClientStore.setState({
      focusedPane: "tasks",
      editViewZone: "stories",
      navigationModality: "keyboard",
      sidebarVisible: true,
    });
  });

  it("keeps the focused pane undimmed and dims an unfocused pane", () => {
    const { stories, workspace } = renderPanePair();

    expect(stories).toHaveClass("ring-1");
    expect(stories).not.toHaveClass("opacity-[0.65]");
    expect(workspace).toHaveClass("opacity-[0.65]");
  });

  it("hides scrollbar chrome in every pane", () => {
    const { stories, workspace } = renderPanePair();

    expect(stories).toHaveClass("hide-scrollbars");
    expect(workspace).toHaveClass("hide-scrollbars");
  });

  it("swaps emphasis when the focused pane store value changes", () => {
    const { stories, workspace } = renderPanePair();

    act(() => useClientStore.setState({ focusedPane: "details-or-terminal" }));

    expect(stories).toHaveClass("opacity-[0.65]");
    expect(workspace).toHaveClass("ring-1");
    expect(workspace).not.toHaveClass("opacity-[0.65]");
  });

  it("transfers full emphasis when an unfocused pane receives pointer focus", () => {
    const { stories, workspace } = renderPanePair();

    fireEvent.mouseDown(workspace);

    expect(useClientStore.getState().focusedPane).toBe("details-or-terminal");
    expect(stories).toHaveClass("opacity-[0.65]");
    expect(workspace).not.toHaveClass("opacity-[0.65]");
  });

  it("removes Stories zone chrome after pointer navigation in edit view", () => {
    useClientStore.getState().setSidebarVisible(false);
    const { stories } = renderPanePair();

    fireEvent.mouseDown(stories!);

    expect(stories).not.toHaveClass("ring-1");
    expect(stories).not.toHaveClass("opacity-[0.65]");
  });
});
