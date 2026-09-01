import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createModule: vi.fn(),
  createProject: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  getTasks: vi.fn(),
  listIssueTypes: vi.fn(),
  listModules: vi.fn(),
  listProjects: vi.fn(),
  putProviderCatalog: vi.fn(),
  writeModuleLink: vi.fn(),
}));

const moduleFolderValidationApi = vi.hoisted(() => ({
  validateModuleFolder: vi.fn(),
}));
const providerState = vi.hoisted(() => ({
  catalog: { activated_providers: [] as string[], global_default: null },
  capabilities: [] as unknown[],
}));

vi.mock("./legacyApiFixture", async () => {
  const actual = await vi.importActual<typeof import("./legacyApiFixture")>(
    "./legacyApiFixture",
  );
  return { ...actual, ...api };
});

vi.mock("../features/work-items/mutationTransport", async () => {
  const actual = await vi.importActual<
    typeof import("../features/work-items/mutationTransport")
  >("../features/work-items/mutationTransport");
  return {
    ...actual,
    createWorkItem: (projectId: string, body: { name?: string; issue_type_id?: string }) =>
      api.createModule(projectId, body.name, body.issue_type_id),
  };
});

vi.mock("../features/work-items/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/work-items/queries/readTransport")),
  readModuleTreeRecords: api.getTasks,
}));

vi.mock("../features/projects/queries/readTransport", async () => {
  const actual = await vi.importActual<typeof import("../features/projects/queries/readTransport")>(
    "../features/projects/queries/readTransport",
  );
  const { projectOpenFixture } = await import("./projectOpenFixture");
  return {
    ...actual,
    readProjects: api.listProjects,
    readProjectOpen: async (projectId: string) => {
      const [projects, modules] = await Promise.all([api.listProjects(), api.listModules(projectId)]);
      const project = projects.find((candidate: { id: string }) => candidate.id === projectId) ?? projects[0];
      if (!project) throw new Error(`Project ${projectId} was not found.`);
      return projectOpenFixture(project, modules);
    },
    readOnboardingProjects: vi.fn(),
  };
});

vi.mock("../features/workflows/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/workflows/queries/readTransport")),
  readWorkflowIssueTypes: api.listIssueTypes,
}));

vi.mock("../features/settings/queries", async () => ({
  ...(await vi.importActual("../features/settings/queries")),
  loadIssueTypes: api.listIssueTypes,
}));

vi.mock("../features/module-links/moduleLinkTransport", async () => ({
  ...(await vi.importActual("../features/module-links/moduleLinkTransport")),
  writeModuleLink: api.writeModuleLink,
}));

vi.mock("../features/workflows/providerQueries", () => ({
  setProviderCapabilities: vi.fn(),
  loadProviderCapabilities: api.getLaunchProviderCapabilities,
  loadConfigurableProviderCapabilities: api.getLaunchProviderCapabilities,
  loadProviderCatalog: async () => (await api.getProviderCatalog()).value,
  updateProviderCatalog: async (value: unknown) =>
    (await api.putProviderCatalog(value)).value,
  useProviderCatalogQuery: () => ({
    data: providerState.catalog,
    isLoading: false,
    isError: false,
  }),
  useConfigurableProviderCapabilitiesQuery: () => ({
    data: providerState.capabilities,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../features/projects/mutationTransport", async () => {
  const actual = await vi.importActual<
    typeof import("../features/projects/mutationTransport")
  >("../features/projects/mutationTransport");
  return { ...actual, createProject: api.createProject };
});

vi.mock("../features/studio/api/moduleFolderValidationApi", () =>
  moduleFolderValidationApi,
);

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import OnboardingTour from "../app/onboarding/OnboardingTour";
import OnboardingWelcome from "../app/onboarding/OnboardingWelcome";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import { useStudioStore } from "../features/projects/store";
import { AddModule } from "../features/studio/modals/AddModule";
import { getModuleLinks, seedModuleLinks } from "../features/module-links";
import type { StudioRuntime } from "../runtime";
import { useClientStore } from "../state/clientStore";
import { stubAppUpdatesRuntime } from "./appUpdatesRuntimeStub";

function folderPickerRuntime(): StudioRuntime {
  return {
    platform: "desktop",
    graphQlTransport: () => { throw new Error("not used"); },
    capabilities: {
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
      appUpdates: true,
    },
    appUpdates: stubAppUpdatesRuntime(),
    readWorkTracker: async () => { throw new Error("unused"); },
    writeWorkTracker: async () => { throw new Error("unused"); },
    readSettings: async () => { throw new Error("unused"); },
    writeSettings: async () => { throw new Error("unused"); },
    statusStream: () => null,
    documentUrl: (documentId, relPath) =>
      `/api/documents/${documentId}/${relPath}`,
    pickFolder: async () => "/repos/picked",
    retryServices: async () => {},
    startup: () => ({
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
  };
}

/** Stand in for the host's authoritative link row. */
const acceptModuleLink = async (moduleId: string, path: string) => {
  seedModuleLinks([
    ...getModuleLinks().filter((link) => link.moduleId !== moduleId),
    { id: `link-${moduleId}`, moduleId, path },
  ]);
};

beforeEach(() => {
  api.createModule.mockReset();
  api.createProject.mockReset();
  moduleFolderValidationApi.validateModuleFolder
    .mockReset()
    .mockResolvedValue({ valid: true, reason: null });
  api.getLaunchProviderCapabilities.mockReset().mockResolvedValue([
    {
      agent: "claude",
      accepts_model: true,
      accepts_any_model: true,
      model_aliases: [],
      model_prefixes: [],
      reasoning_levels: [],
    },
  ]);
  api.getProviderCatalog.mockReset().mockResolvedValue({
    value: { activated_providers: [], global_default: null },
  });
  api.getTasks.mockReset().mockResolvedValue({
    rootIds: [],
    children: {},
    order: [],
    states: [],
    workItems: [],
  });
  api.listIssueTypes.mockReset().mockResolvedValue([
    { id: "module-type", name: "Module", level: "module", sort_order: 0 },
  ]);
  api.listModules.mockReset().mockResolvedValue([]);
  api.listProjects.mockReset().mockResolvedValue([]);
  api.writeModuleLink.mockReset().mockImplementation(acceptModuleLink);
  api.putProviderCatalog.mockReset().mockImplementation(async (value) => ({ value }));

  seedModuleLinks([]);
  useOnboardingTourStore.getState().reset();
  useStudioStore.setState({
    selectedProjectId: null,
    activeView: "backlog",
    error: null,
  });
  useClientStore.setState({
    selectedModuleId: null,
    selectedTaskId: null,
    workspaceSelection: { kind: "task" },
  });
  useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
});

describe("onboarding and module-folder acceptance", () => {
  it("[overhaul-28] composes disabled-Projects onboarding with retryable default-project resolution", async () => {
    api.createProject
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        id: "project-1",
        name: "Coding",
        slug: "CDN",
        description: "",
      });

    render(<OnboardingWelcome />);

    expect(await screen.findByRole("heading", { name: "Your agents" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Your first project" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "I use claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The resolved default project is unavailable.",
    );
    expect(useOnboardingTourStore.getState().projectId).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    await waitFor(() => {
      expect(useOnboardingTourStore.getState()).toMatchObject({
        step: "module-create",
        projectId: "project-1",
      });
    });
    expect(api.createProject).toHaveBeenCalledTimes(2);
  });

  it("[overhaul-29] sends guided module setup through Add Module and advances after a valid link", async () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useOnboardingTourStore.getState().start("project-1");
    api.createModule.mockResolvedValue({
      id: "module-guided",
      name: "General",
      project_id: "project-1",
    });
    api.writeModuleLink
      .mockReset()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementation(acceptModuleLink);

    render(
      <>
        <ModulesPane />
        <OnboardingTour onSelectStory={vi.fn()} />
        <ModalHost />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: "Add your first module" }),
    ).toBeVisible();
    expect(screen.getByText(/Multiple modules can use the same folder/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Skip tour" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create module" }),
    ).not.toBeInTheDocument();
    const addModule = await screen.findByRole("button", {
      name: "+ Add Module",
    });
    await waitFor(() =>
      expect(addModule).toHaveAttribute("data-coach-highlight", "true"),
    );

    fireEvent.click(addModule);
    expect(
      await screen.findByRole("dialog", { name: "Add Module" }),
    ).toBeVisible();
    expect(addModule).not.toHaveAttribute("data-coach-highlight");
    const nameInput = screen.getByRole("textbox", { name: "Module name" });
    expect(screen.getByRole("heading", { name: "Name the module" })).toBeVisible();
    expect(screen.getByText(/label for a set of related stories/)).toBeVisible();
    await waitFor(() =>
      expect(nameInput).toHaveAttribute("data-coach-highlight", "true"),
    );
    expect(
      screen.queryByRole("button", { name: "Skip tour" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const folderGuide = screen.getByRole("heading", {
      name: "Choose where work runs",
    });
    expect(folderGuide).toBeVisible();
    expect(screen.getByText(/folder containing the code this module works on/)).toBeVisible();
    const folderSection = screen
      .getByText("Project working directory (CWD)")
      .closest('[data-coach-anchor="module-folder"]');
    await waitFor(() =>
      expect(folderSection).toHaveAttribute("data-coach-highlight", "true"),
    );
    expect(nameInput).not.toHaveAttribute("data-coach-highlight");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(folderGuide).not.toBeInTheDocument();
    expect(folderSection).not.toHaveAttribute("data-coach-highlight");
    expect(screen.getByText(/groups related stories/)).toBeVisible();
    expect(screen.getByText("Project working directory (CWD)")).toBeVisible();
    expect(screen.getByText(/does not need to match the folder name/)).toBeVisible();
    expect(screen.getByText(/Multiple modules can/)).toBeVisible();

    const folderInput = screen.getByRole("textbox", { name: "Module folder" });

    fireEvent.change(nameInput, {
      target: { value: "General" },
    });
    fireEvent.change(folderInput, {
      target: { value: "/repos/guided" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));

    expect(
      await screen.findByText(/Module created, but its folder could not be saved/),
    ).toBeVisible();
    expect(useOnboardingTourStore.getState().step).toBe("module-create");
    expect(api.createModule).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Save folder" }));

    await waitFor(() => {
      expect(useOnboardingTourStore.getState()).toMatchObject({
        step: "story-create",
        moduleId: "module-guided",
      });
    });
    expect(api.createModule).toHaveBeenCalledOnce();
    expect(useClientStore.getState().selectedModuleId).toBe("module-guided");
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Skip tour" }),
    ).toBeVisible();
  });

  it("[overhaul-29a] restores the module coach mark when Add Module is cancelled", async () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useOnboardingTourStore.getState().start("project-1");

    render(
      <>
        <OnboardingTour onSelectStory={vi.fn()} />
        <ModalHost />
      </>,
    );
    act(() => useModalStore.getState().pushModal({ type: "add-module" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("heading", { name: "Add your first module" }),
    ).toBeVisible();
    expect(useOnboardingTourStore.getState().step).toBe("module-create");
  });

  it("[overhaul-29b] keeps the desktop folder picker beside the described CWD input", () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });

    render(<AddModule runtime={folderPickerRuntime()} />);

    const folderInput = screen.getByRole("textbox", { name: "Module folder" });
    const pickFolder = screen.getByRole("button", { name: "Pick Folder" });
    expect(folderInput.parentElement).toBe(pickFolder.parentElement);
    expect(folderInput).toHaveAccessibleDescription(
      /Ticketry starts terminals and coding agents here.*Multiple modules can use the same folder/,
    );
    expect(screen.getByRole("textbox", { name: "Module name" })).toHaveAccessibleDescription(
      /does not need to match the folder name/,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Module name" }), {
      target: { value: "Frontend" },
    });
    fireEvent.change(folderInput, { target: { value: "relative-folder" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the full folder path",
    );
    expect(screen.getByRole("button", { name: "Create module" })).toBeDisabled();
  });

  it("[overhaul-125] refuses a missing CWD before creating the module", async () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    moduleFolderValidationApi.validateModuleFolder.mockResolvedValueOnce({
      valid: false,
      reason: "module_folder_missing",
    });

    render(<AddModule runtime={folderPickerRuntime()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Module name" }), {
      target: { value: "Frontend" },
    });
    const folderInput = screen.getByRole("textbox", {
      name: "Module folder",
    });
    fireEvent.change(folderInput, {
      target: { value: "/adfra/asdf/asdf/asdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The project working directory does not exist.",
    );
    expect(folderInput).toHaveAttribute("aria-invalid", "true");
    expect(api.createModule).not.toHaveBeenCalled();
    expect(api.writeModuleLink).not.toHaveBeenCalled();
  });

  it("[overhaul-29c] keeps modal teaching cards beside their fields inside the modal", async () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useOnboardingTourStore.getState().start("project-1");
    useModalStore.setState({ modalStack: [{ type: "add-module" }] });
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const box = (
          left: number,
          top: number,
          width: number,
          height: number,
        ) =>
          ({
            x: left,
            y: top,
            top,
            left,
            right: left + width,
            bottom: top + height,
            width,
            height,
            toJSON: () => ({}),
          }) as DOMRect;
        if (this.getAttribute("aria-modal") === "true") {
          return box(250, 100, 400, 600);
        }
        if (this.getAttribute("data-coach-anchor") === "module-name") {
          return box(300, 160, 300, 40);
        }
        return box(0, 0, 320, 140);
      });

    render(
      <>
        <OnboardingTour onSelectStory={vi.fn()} />
        <ModalHost />
      </>,
    );

    expect(
      await screen.findByRole("dialog", { name: "Add Module" }),
    ).toBeVisible();
    const guide = screen.getByRole("dialog", { name: "Name the module" });
    await waitFor(() =>
      expect(guide).toHaveAttribute("data-placement-side", "below"),
    );
    expect(guide).toHaveStyle({ left: "290px", top: "208px" });
    expect(290).toBeGreaterThanOrEqual(250);
    expect(290 + 320).toBeLessThanOrEqual(650);
    rect.mockRestore();
  });

  it("[overhaul-30] keeps ordinary Add Module open through link failure and closes after retry", async () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useModalStore.setState({ modalStack: [{ type: "add-module" }] });
    api.createModule.mockResolvedValue({
      id: "module-added",
      name: "Runtime",
      project_id: "project-1",
    });
    api.writeModuleLink
      .mockReset()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementation(acceptModuleLink);

    render(<AddModule />);
    fireEvent.change(screen.getByPlaceholderText("Module name"), {
      target: { value: "Runtime" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), {
      target: { value: "/repos/runtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));

    expect(await screen.findByText(/Module created, but its folder could not be saved/)).toBeVisible();
    expect(useModalStore.getState().modalStack).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save folder" }));

    await waitFor(() => expect(useModalStore.getState().modalStack).toEqual([]));
    expect(api.createModule).toHaveBeenCalledOnce();
    expect(useClientStore.getState().selectedModuleId).toBe("module-added");
  });

  it("[overhaul-31] preserves selection on cancel and save failure, then resumes after a valid link", async () => {
    seedModuleLinks([{ id: "link-module-old", moduleId: "module-old", path: "/repos/old" }]);
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({ selectedModuleId: "module-old", selectedTaskId: "story-old" });

    render(<ModalHost />);
    await act(async () => {
      await useClientStore.getState().selectModule("module-new");
    });
    expect(await screen.findByRole("dialog", { name: "Module Folder" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useClientStore.getState().selectedModuleId).toBe("module-old");

    api.writeModuleLink
      .mockReset()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementation(acceptModuleLink);
    await act(async () => {
      await useClientStore.getState().selectModule("module-new");
    });
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save the module folder. Retry to continue.",
    );
    expect(useClientStore.getState().selectedModuleId).toBe("module-old");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-new"));
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).not.toBeInTheDocument();
  });
});
