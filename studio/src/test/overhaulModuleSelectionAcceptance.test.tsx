import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./legacyApiFixture", async () => {
  const actual = await vi.importActual<typeof import("./legacyApiFixture")>(
    "./legacyApiFixture",
  );
  return {
    ...actual,
    getTasks: vi.fn(),
  };
});

vi.mock("../features/module-links/moduleLinkTransport", async () => ({
  ...(await vi.importActual("../features/module-links/moduleLinkTransport")),
  writeModuleLink: vi.fn(),
}));

vi.mock("../features/work-items/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/work-items/queries/readTransport")),
  readModuleTreeRecords: vi.fn(),
}));

import { ModalHost, useModalStore } from "../app/modal";
import { useStudioStore } from "../features/projects/store";
import {
  getModuleFolder,
  getModuleLinks,
  seedModuleLinks,
} from "../features/module-links";
import * as moduleLinkTransport from "../features/module-links/moduleLinkTransport";
import * as workItemReadTransport from "../features/work-items/queries/readTransport";
import { useClientStore } from "../state/clientStore";

const getTasks = workItemReadTransport.readModuleTreeRecords as ReturnType<typeof vi.fn>;
const writeModuleLink = moduleLinkTransport.writeModuleLink as ReturnType<typeof vi.fn>;

function seedLinkedModule(): void {
  // A folder belongs to its Module and to nothing else.
  seedModuleLinks([
    { id: "link-module-current", moduleId: "module-current", path: "/repos/current" },
  ]);
}

describe("module-folder selection acceptance", () => {
  beforeEach(() => {
    getTasks.mockReset().mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    writeModuleLink
      .mockReset()
      .mockImplementation(async (moduleId: string, path: string) => {
        seedModuleLinks([
          ...getModuleLinks().filter((link) => link.moduleId !== moduleId),
          { id: `link-${moduleId}`, moduleId, path },
        ]);
      });
    seedLinkedModule();
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-current",
      selectedTaskId: "task-current",
    });
    useModalStore.setState({ modalStack: [] });
  });

  it("preserves the current module when the pathless-module prompt is cancelled", async () => {
    await useClientStore.getState().selectModule("module-new");

    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(getTasks).not.toHaveBeenCalled();
    expect(useModalStore.getState().modalStack).toEqual([
      {
        type: "module-folder",
        payload: {
          moduleId: "module-new",
          resumeModuleSelection: true,
        },
      },
    ]);

    render(<ModalHost />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(useClientStore.getState().selectedTaskId).toBe("task-current");
  });

  it("preserves the current module when the folder link cannot be saved", async () => {
    writeModuleLink.mockRejectedValueOnce(new Error("save failed"));
    await useClientStore.getState().selectModule("module-new");
    render(<ModalHost />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Could not save the module folder");
    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(getModuleFolder("module-new")).toBeUndefined();
    expect(getTasks).not.toHaveBeenCalled();
  });

  it("resumes module selection only after the module link is saved", async () => {
    await useClientStore.getState().selectModule("module-new");
    render(<ModalHost />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    expect(useClientStore.getState().selectedModuleId).toBe("module-current");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(useClientStore.getState().selectedModuleId).toBe("module-new");
    });
    expect(writeModuleLink).toHaveBeenCalledWith("module-new", "/repos/new");
    expect(getModuleFolder("module-current")).toBe("/repos/current");
    expect(getModuleFolder("module-new")).toBe("/repos/new");
    expect(getTasks).toHaveBeenCalledWith("project-1", "module-new");
  });
});
