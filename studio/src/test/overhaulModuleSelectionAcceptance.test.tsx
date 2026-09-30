import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import { ModuleFolderRequired } from "../features/terminal-panel/ModuleFolderRequired";
import { DialogHost } from "../app/shell/DialogHost";
import { useDialogStore } from "../app/shell/dialogStore";
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
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { initializeStudioRuntime, type DirectoryTrustResult, type StudioRuntime } from "../runtime";

function trustRuntime(
  prepareDirectoryTrust: NonNullable<StudioRuntime["prepareDirectoryTrust"]>,
): StudioRuntime {
  return { ...createBrowserRuntime({ environment: {} }), platform: "desktop", prepareDirectoryTrust };
}

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
    initializeStudioRuntime(trustRuntime(async () => ({
      status: "already_trusted",
      approval: null,
      directory: "/repos/new",
    })));
    useDialogStore.setState({ dialogs: [] });
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

  it("[overhaul-292] resumes module selection for an already-trusted folder after its link is saved", async () => {
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

  it("[overhaul-291] keeps module selection unchanged after trust refusal and retries the same folder", async () => {
    initializeStudioRuntime(trustRuntime(async (provider, _directory, approval) => ({
      status: approval ? "prepared" : "approval_required",
      approval: approval ? null : `${provider}-approval`,
      directory: "/repos/new",
    })));
    seedLinkedModule();
    await useClientStore.getState().selectModule("module-new");
    render(<><ModalHost /><DialogHost /></>);
    await act(async () => { await vi.dynamicImportSettled(); });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/repos/new" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const consent = await screen.findByRole("dialog", { name: "Trust module folder?" });
    fireEvent.click(within(consent).getByRole("button", { name: "Cancel" }));
    expect(writeModuleLink).not.toHaveBeenCalled();
    expect(getModuleFolder("module-new")).toBeUndefined();
    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(getTasks).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trust folder" }));
    await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-new"));
    expect(writeModuleLink).toHaveBeenCalledTimes(1);
    expect(getModuleFolder("module-new")).toBe("/repos/new");
  });


  it("[overhaul-293] preserves the existing folder until replacement folder trust completes", async () => {
    let finishTrust!: (result: { status: "already_trusted"; approval: null }) => void;
    const trust = vi.fn(async (provider: string): Promise<DirectoryTrustResult> => {
      if (provider !== "codex") return { status: "already_trusted" as const, approval: null };
      return new Promise<DirectoryTrustResult>((resolve) => { finishTrust = resolve; });
    });
    initializeStudioRuntime(trustRuntime(trust));
    seedLinkedModule();
    const onSaved = vi.fn();
    useModalStore.getState().pushModal({ type: "module-folder", payload: { moduleId: "module-current", onSaved } });
    render(<ModalHost />);
    await act(async () => { await vi.dynamicImportSettled(); });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/repos/replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(trust).toHaveBeenCalledWith("codex", "/repos/replacement", null));
    expect(writeModuleLink).not.toHaveBeenCalled();
    expect(getModuleFolder("module-current")).toBe("/repos/current");
    expect(onSaved).not.toHaveBeenCalled();
    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByText("/repos/current"));
    expect(screen.getByRole("textbox")).toHaveValue("/repos/replacement");
    await act(async () => { finishTrust({ status: "already_trusted", approval: null }); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(getModuleFolder("module-current")).toBe("/repos/replacement");
  });

  it("[overhaul-294] retries a terminal folder trust failure before reopening its shell", async () => {
    const trust = vi
      .fn()
      .mockRejectedValueOnce(new Error("Trust configuration is read-only"))
      .mockImplementation(async () => ({
        status: "already_trusted",
        approval: null,
      }));
    initializeStudioRuntime(trustRuntime(trust));
    seedLinkedModule();
    const onLinked = vi.fn();
    render(<ModuleFolderRequired moduleId="module-current" reason="module_folder_missing" onLinked={onLinked} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/repos/replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/trust.*retry/i);
    expect(writeModuleLink).not.toHaveBeenCalled();
    expect(getModuleFolder("module-current")).toBe("/repos/current");
    expect(onLinked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
    expect(writeModuleLink).toHaveBeenCalledTimes(1);
    expect(getModuleFolder("module-current")).toBe("/repos/replacement");
  });

});
