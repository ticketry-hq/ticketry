import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CODING-2248: onboarding may create its module with folder setup explicitly
// deferred; ordinary Add Module keeps its required folder.

const api = vi.hoisted(() => ({
  createModule: vi.fn(),
  getTasks: vi.fn(),
  prepareDirectoryTrust: vi.fn(),
  validateModuleFolder: vi.fn(),
  writeModuleLink: vi.fn(),
}));

vi.mock("../features/work-items/mutationTransport", async () => ({
  ...(await vi.importActual("../features/work-items/mutationTransport")),
  createWorkItem: (projectId: string, body: { name?: string }) =>
    api.createModule(projectId, body.name),
}));

vi.mock("../features/work-items/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/work-items/queries/readTransport")),
  readModuleTreeRecords: api.getTasks,
}));

vi.mock("../features/settings/queries", async () => ({
  ...(await vi.importActual("../features/settings/queries")),
  loadIssueTypes: async () => [{ id: "module-type", name: "Module", level: "module", sort_order: 0 }],
}));

vi.mock("../features/module-links/moduleLinkTransport", async () => ({
  ...(await vi.importActual("../features/module-links/moduleLinkTransport")),
  writeModuleLink: api.writeModuleLink,
}));

vi.mock("../features/studio/api/moduleFolderValidationApi", () => ({
  validateModuleFolder: api.validateModuleFolder,
}));

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import OnboardingTour from "../app/onboarding/OnboardingTour";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { DialogHost } from "../app/shell/DialogHost";
import { useDialogStore } from "../app/shell/dialogStore";
import { getModuleFolder, getModuleLinks, seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { initializeStudioRuntime } from "../runtime";
import { useClientStore } from "../state/clientStore";

const DEFERRAL_GUIDANCE = "You can capture ideas now. Choose a local folder before running an agent.";

function renderAddModule() {
  render(<><OnboardingTour onSelectStory={vi.fn()} /><ModalHost /><DialogHost /></>);
  act(() => useModalStore.getState().pushModal({ type: "add-module" }));
}

beforeEach(() => {
  initializeStudioRuntime({
    ...createBrowserRuntime({ environment: {} }),
    platform: "desktop",
    prepareDirectoryTrust: api.prepareDirectoryTrust,
  });
  useDialogStore.setState({ dialogs: [] });
  api.createModule.mockReset().mockResolvedValue({ id: "module-new", name: "Welcome", project_id: "project-1" });
  api.getTasks.mockReset().mockResolvedValue({ rootIds: [], children: {}, order: [], states: [], workItems: [] });
  api.prepareDirectoryTrust.mockReset().mockResolvedValue({ status: "already_trusted", approval: null });
  api.validateModuleFolder.mockReset().mockResolvedValue({ valid: true, reason: null });
  api.writeModuleLink.mockReset().mockImplementation(async (moduleId: string, path: string) => {
    seedModuleLinks([
      ...getModuleLinks().filter((link) => link.moduleId !== moduleId),
      { id: `link-${moduleId}`, moduleId, path },
    ]);
  });
  seedModuleLinks([]);
  useOnboardingTourStore.getState().reset();
  useStudioStore.setState({ selectedProjectId: "project-1", activeView: "backlog", error: null });
  useClientStore.setState({ selectedModuleId: null, selectedTaskId: null, workspaceSelection: { kind: "task" } });
  useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
});

describe("overhaul acceptance — folderless onboarding module", () => {
  it("[overhaul-402] onboarding creates a named module with folder setup deferred; ordinary Add Module still requires a folder", async () => {
    useOnboardingTourStore.getState().start("project-1");
    renderAddModule();

    expect(await screen.findByText(DEFERRAL_GUIDANCE)).toBeVisible();
    const defer = screen.getByRole("button", { name: "Set up folder later" });
    expect(defer).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Module name" }), { target: { value: "Welcome" } });
    expect(screen.getByRole("button", { name: "Create module" })).toBeDisabled();

    // Dismissing the form is not a successful creation.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useOnboardingTourStore.getState().step).toBe("module-create");
    expect(api.createModule).not.toHaveBeenCalled();

    act(() => useModalStore.getState().pushModal({ type: "add-module" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Module name" }), { target: { value: "Welcome" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up folder later" }));

    await waitFor(() => expect(useOnboardingTourStore.getState()).toMatchObject({
      step: "story-create",
      moduleId: "module-new",
    }));
    expect(api.createModule).toHaveBeenCalledOnce();
    expect(api.createModule).toHaveBeenCalledWith("project-1", "Welcome");
    expect(api.validateModuleFolder).not.toHaveBeenCalled();
    expect(api.prepareDirectoryTrust).not.toHaveBeenCalled();
    expect(api.writeModuleLink).not.toHaveBeenCalled();
    expect(getModuleFolder("module-new")).toBeUndefined();
    expect(useClientStore.getState().selectedModuleId).toBe("module-new");
    expect(api.getTasks).toHaveBeenCalledWith("project-1", "module-new");
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your first story" })).toBeVisible();

    // After onboarding, ordinary Add Module offers no deferral and needs a folder.
    act(() => useOnboardingTourStore.getState().reset());
    act(() => useModalStore.getState().pushModal({ type: "add-module" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Module name" }), { target: { value: "Runtime" } });
    expect(screen.queryByRole("button", { name: "Set up folder later" })).not.toBeInTheDocument();
    expect(screen.queryByText(DEFERRAL_GUIDANCE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create module" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), { target: { value: "relative" } });
    expect(screen.getByRole("button", { name: "Create module" })).toBeDisabled();
    expect(api.createModule).toHaveBeenCalledOnce();
  });

  it("[overhaul-405] selecting or reopening a folderless module loads planning without a folder prompt, including after onboarding", async () => {
    seedModuleLinks([{ id: "link-linked", moduleId: "module-linked", path: "/repos/linked" }]);
    useClientStore.setState({ selectedModuleId: "module-linked", selectedTaskId: null });
    render(<ModalHost />);

    await act(async () => { await useClientStore.getState().selectModule("module-new"); });
    expect(useClientStore.getState().selectedModuleId).toBe("module-new");
    expect(api.getTasks).toHaveBeenLastCalledWith("project-1", "module-new");

    await act(async () => { await useClientStore.getState().selectModule("module-linked"); });
    await act(async () => { await useClientStore.getState().selectModule("module-new"); });
    expect(useClientStore.getState().selectedModuleId).toBe("module-new");
    expect(api.getTasks).toHaveBeenCalledTimes(3);
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).not.toBeInTheDocument();
    expect(getModuleFolder("module-new")).toBeUndefined();
  });

  it("[overhaul-406] onboarding with a supplied folder still validates and links it; an invalid folder is never taken as deferral", async () => {
    useOnboardingTourStore.getState().start("project-1");
    api.validateModuleFolder
      .mockResolvedValueOnce({ valid: false, reason: "module_folder_missing" })
      .mockResolvedValue({ valid: true, reason: null });
    renderAddModule();

    fireEvent.change(await screen.findByRole("textbox", { name: "Module name" }), { target: { value: "Welcome" } });
    const folder = screen.getByRole("textbox", { name: "Module folder" });
    fireEvent.change(folder, { target: { value: "relative" } });
    expect(screen.getByRole("button", { name: "Set up folder later" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create module" })).toBeDisabled();

    fireEvent.change(folder, { target: { value: "/repos/missing" } });
    expect(screen.getByRole("button", { name: "Set up folder later" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(await screen.findByText("The project working directory does not exist.")).toBeVisible();
    expect(api.createModule).not.toHaveBeenCalled();
    expect(useOnboardingTourStore.getState().step).toBe("module-create");

    fireEvent.change(folder, { target: { value: "/repos/welcome" } });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    await waitFor(() => expect(useOnboardingTourStore.getState().step).toBe("story-create"));
    expect(api.createModule).toHaveBeenCalledOnce();
    expect(api.writeModuleLink).toHaveBeenCalledWith("module-new", "/repos/welcome");
    expect(getModuleFolder("module-new")).toBe("/repos/welcome");
    expect(useClientStore.getState().selectedModuleId).toBe("module-new");
  });
});
