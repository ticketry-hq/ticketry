import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { StudioShell } from "../app/shell/StudioShell";
import { getModuleFolder, seedModuleLinks } from "../features/module-links";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio } from "./seam";

describe("idea-entry draft acceptance", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("[overhaul-361] preserves a missing-folder module's mounted draft while Module Manager covers and restores it", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    seedModuleLinks([]);
    useClientStore.setState({ sidebarVisible: false });

    mountStudio({ http, children: <StudioShell /> });

    expect(getModuleFolder("module-1")).toBeUndefined();
    const workspace = await screen.findByTestId("module-workspace-region");
    const ideaEntry = within(workspace).getByRole("textbox", {
      name: "Capture an idea",
    });

    fireEvent.change(ideaEntry, {
      target: { value: "Plan a simple welcome page" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));

    expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
    expect(ideaEntry).toBeInTheDocument();
    expect(ideaEntry).toHaveValue("Plan a simple welcome page");
    expect(ideaEntry.closest("[inert]")).not.toBeNull();
    expect(within(workspace).queryByRole("textbox", { name: "Capture an idea" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close Module Manager", expanded: true }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());

    expect(within(workspace).getByRole("textbox", {
      name: "Capture an idea",
    })).toBe(ideaEntry);
    expect(ideaEntry).toHaveValue("Plan a simple welcome page");
    expect(ideaEntry).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Module Manager" })).toHaveAttribute("aria-expanded", "false");
  });
});
