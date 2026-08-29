import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleFolder } from "../features/agents/terminal/ModuleFolder";
import { useModalStore } from "../app/modal";
import { getModuleFolder, seedModuleLinks } from "../features/module-links";
import * as moduleLinkTransport from "../features/module-links/moduleLinkTransport";

const { selectModule } = vi.hoisted(() => ({
  selectModule: vi.fn(),
}));

vi.mock("../state/clientStore", () => ({
  useClientStore: {
    getState: () => ({ selectModule }),
  },
}));

describe("module-folder selection acceptance", () => {
  beforeEach(() => {
    selectModule.mockReset();
    selectModule.mockResolvedValue(undefined);
    seedModuleLinks([]);
    useModalStore.setState({
      modalStack: [
        {
          type: "module-folder",
          payload: { moduleId: "module-1", resumeModuleSelection: true },
        },
      ],
    });
  });

  it("rejects blank folders, then trims the saved path before resuming selection", async () => {
    // The write lands in the link graph, so the fake stands in for the host's
    // authoritative row rather than for a rewritten profile.
    const writeModuleLink = vi
      .spyOn(moduleLinkTransport, "writeModuleLink")
      .mockImplementation(async (moduleId, path) => {
        seedModuleLinks([{ id: `link-${moduleId}`, moduleId, path }]);
      });
    render(
      <ModuleFolder
        payload={{ moduleId: "module-1", resumeModuleSelection: true }}
      />,
    );

    const input = screen.getByRole("textbox");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).toBeDisabled();
    expect(writeModuleLink).not.toHaveBeenCalled();
    expect(selectModule).not.toHaveBeenCalled();
    expect(useModalStore.getState().modalStack).toHaveLength(1);

    fireEvent.change(input, { target: { value: "  /repos/ticketry  " } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeModuleLink).toHaveBeenCalledWith("module-1", "/repos/ticketry");
    expect(getModuleFolder("module-1")).toBe("/repos/ticketry");
    expect(selectModule).toHaveBeenCalledWith("module-1");
    expect(useModalStore.getState().modalStack).toEqual([]);
  });
});
