import { act, render, screen } from "@testing-library/react";
import { PanelGroup } from "react-resizable-panels";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/shell/sidebar/modules/ModulesPane", () => ({
  ModulesPane: () => <div>Modules pane contents</div>,
}));

vi.mock("../features/terminal-panel", () => ({
  FooterTerminalToggle: () => <button type="button">Terminal</button>,
  routeTerminalPanelToggle: () => false,
  toggleTerminalPanel: () => {},
}));

vi.mock("../features/agents/terminal/appNavigation", () => ({
  bucketFor: () => "bucket",
  useWorkspaceTabsStore: { getState: () => ({}) },
}));

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/appNavigation",
  () => ({
    closeTerminalTab: () => {},
    useTicketWorkspaceStore: { getState: () => ({}) },
  }),
);

import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { StudioFooter } from "../app/shell/StudioFooter";
import { DEFAULT_PANEL_LAYOUT } from "../app/shell/layout/layoutMath";
import { StudioSidebar } from "../app/shell/sidebar/StudioSidebar";
import { useClientStore } from "../state/clientStore";

function KeymapHarness() {
  useGlobalKeymap();
  return null;
}

function ModulesSurface() {
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  if (!sidebarVisible) return null;
  return (
    <PanelGroup direction="horizontal">
      <StudioSidebar layout={DEFAULT_PANEL_LAYOUT} />
    </PanelGroup>
  );
}

function renderCommandBar() {
  return render(
    <>
      <KeymapHarness />
      <ModulesSurface />
      <StudioFooter />
    </>,
  );
}

function pressGlobalChord(
  key: string,
  modifiers: Pick<
    KeyboardEventInit,
    "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
  > = {},
) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      }),
    );
  });
}

describe("overhaul acceptance — command-bar Modules toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    studioKeymapRegistry.setOverrides([]);
    useClientStore.setState({
      sidebarVisible: false,
      focusedPane: "details-or-terminal",
      editViewZone: "active-tab-body",
      editViewBodyEngaged: true,
    });
  });

  it("[overhaul-139] keeps the Modules pane hard-disabled", () => {
    let sidebarChanges = 0;
    const unsubscribe = useClientStore.subscribe((state, previous) => {
      if (state.sidebarVisible !== previous.sidebarVisible) sidebarChanges += 1;
    });

    renderCommandBar();

    expect(screen.queryByTestId("pane-modules")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Modules pane/ }),
    ).not.toBeInTheDocument();

    act(() => useClientStore.getState().setSidebarVisible(true));
    expect(sidebarChanges).toBe(0);
    expect(useClientStore.getState().sidebarVisible).toBe(false);

    pressGlobalChord("\\");
    expect(sidebarChanges).toBe(0);
    expect(useClientStore.getState().sidebarVisible).toBe(false);

    act(() => {
      studioKeymapRegistry.setOverrides([
        {
          context: "global",
          actionId: "toggle-sidebar",
          chord: {
            key: "m",
            alt: true,
            control: false,
            meta: false,
            shift: false,
          },
        },
      ]);
    });
    pressGlobalChord("m", { altKey: true });
    expect(sidebarChanges).toBe(0);
    expect(screen.queryByTestId("pane-modules")).not.toBeInTheDocument();
    expect(localStorage.getItem("studio.sidebarVisible:v1")).toBe("false");

    unsubscribe();
  });
});
