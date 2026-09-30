import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../app/shell/layout/useStudioPanelLayout", async () => {
  const { useClientStore } = await vi.importActual<
    typeof import("../state/clientStore")
  >("../state/clientStore");

  return {
    useStudioPanelLayout: () => ({
      layout: [18, 32, 50],
      sidebarVisible: useClientStore((state) => state.sidebarVisible),
      outerGroupRef: { current: null },
      workAreaGroupRef: { current: null },
      handleOuterLayout: () => {},
      handleWorkAreaLayout: () => {},
    }),
  };
});

import { StudioLayout } from "../app/shell/StudioLayout";
import { getModuleFolder, seedModuleLinks } from "../features/module-links";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio } from "./seam";

describe("idea-entry draft acceptance", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("[overhaul-361] preserves a missing-folder module's draft when the Modules pane opens and closes", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    seedModuleLinks([]);
    useClientStore.setState({ sidebarVisible: false });

    mountStudio({ http, children: <StudioLayout /> });

    expect(getModuleFolder("module-1")).toBeUndefined();
    let workspace = await screen.findByTestId("module-workspace-region");
    let ideaEntry = within(workspace).getByRole("textbox", {
      name: "Capture an idea",
    });

    fireEvent.change(ideaEntry, {
      target: { value: "Plan a simple welcome page" },
    });
    fireEvent.click(within(workspace).getByRole("button", {
      name: "Open Modules pane",
    }));

    workspace = await screen.findByTestId("module-workspace-region");
    ideaEntry = within(workspace).getByRole("textbox", {
      name: "Capture an idea",
    });
    expect(ideaEntry).toHaveValue("Plan a simple welcome page");

    fireEvent.change(ideaEntry, {
      target: { value: "Draft should survive pane toggle" },
    });
    fireEvent.click(within(workspace).getByRole("button", {
      name: "Close Modules pane",
    }));

    workspace = await screen.findByTestId("module-workspace-region");
    expect(within(workspace).getByRole("textbox", {
      name: "Capture an idea",
    })).toHaveValue("Draft should survive pane toggle");
    expect(within(workspace).getByRole("button", {
      name: "Open Modules pane",
    })).toHaveAttribute("aria-expanded", "false");
  });
});
