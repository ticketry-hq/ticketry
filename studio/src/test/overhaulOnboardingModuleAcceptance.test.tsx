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
  putProfile: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return { ...actual, ...api };
});

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import OnboardingTour from "../app/onboarding/OnboardingTour";
import OnboardingWelcome from "../app/onboarding/OnboardingWelcome";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { useStudioStore } from "../features/projects/store";
import { AddModule } from "../features/studio/modals/AddModule";
import {
  getConfigSnapshot,
  seedConfig,
} from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

const profile = (moduleLinks: Array<{ module_id: string; path: string }> = []) => ({
  name: "Local",
  workspace_slug: "meml",
  agent_prompt: null,
  agent_prompts: {},
  module_links: moduleLinks,
  recent_project_id: "project-1",
  recent_module_ids: {},
});

const configResponse = (body: ReturnType<typeof profile>) => ({
  recent_profile_index: 0,
  features: getConfigSnapshot().features,
  profiles: [body],
});

beforeEach(() => {
  queryClient.clear();
  api.createModule.mockReset();
  api.createProject.mockReset();
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
  api.putProfile.mockReset();
  api.putProviderCatalog.mockReset().mockImplementation(async (value) => ({ value }));

  seedConfig({
    profiles: [profile()],
    recentProfileIndex: 0,
    features: { sidebar: true, projects: false },
  });
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

  it("[overhaul-29] retries guided module linking without creating a duplicate", async () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useOnboardingTourStore.getState().start("project-1");
    api.createModule.mockResolvedValue({
      id: "module-guided",
      name: "General",
      project_id: "project-1",
    });
    api.putProfile
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementation(async (_index, body) => configResponse(body));

    render(<OnboardingTour onSelectStory={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), {
      target: { value: "/repos/guided" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));

    expect(await screen.findByTestId("onboarding-step-error")).toHaveTextContent(
      "Module created, but its folder could not be saved.",
    );
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
  });

  it("[overhaul-30] keeps ordinary Add Module open through link failure and closes after retry", async () => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useModalStore.setState({ modalStack: [{ type: "add-module" }] });
    api.createModule.mockResolvedValue({
      id: "module-added",
      name: "Runtime",
      project_id: "project-1",
    });
    api.putProfile
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementation(async (_index, body) => configResponse(body));

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
    seedConfig({ profiles: [profile([{ module_id: "module-old", path: "/repos/old" }])] });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({ selectedModuleId: "module-old", selectedTaskId: "story-old" });

    render(<ModalHost />);
    await act(async () => {
      await useClientStore.getState().selectModule("module-new");
    });
    expect(await screen.findByRole("dialog", { name: "Module Folder" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useClientStore.getState().selectedModuleId).toBe("module-old");

    api.putProfile
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementation(async (_index, body) => configResponse(body));
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
