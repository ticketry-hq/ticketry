import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceApi = vi.hoisted(() => ({ acknowledgeOnboarding: vi.fn() }));
const fetchMock = vi.fn();

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...workspaceApi,
}));

import OnboardingTour from "../app/onboarding/OnboardingTour";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { DEFAULT_PANEL_LAYOUT } from "../app/shell/layout/layoutMath";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import { ProjectsPane } from "../app/shell/sidebar/projects/ProjectsPane";
import {
  getConfigSnapshot,
  isSidebarEnabled,
  seedConfig,
  useConfig,
} from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useClientStore } from "../state/clientStore";

const CUSTOM_PANEL_LAYOUT = [12, 24, 40, 24];

interface Features {
  sidebar: boolean;
  projects: boolean;
}

function startTourFromLayout(
  sidebarVisible: boolean,
  panelLayout: number[] | null,
  features: Features = { sidebar: true, projects: true },
) {
  useOnboardingTourStore.getState().reset();
  seedConfig({ features });
  useClientStore.setState({ sidebarVisible, panelLayout });
  useOnboardingTourStore.getState().start("project-created");
}

function TourSurface() {
  const config = useConfig();
  const sidebarEnabled = isSidebarEnabled(config);
  const projectsEnabled = config.features.projects;

  return (
    <>
      {sidebarEnabled ? (
        <>
          {projectsEnabled ? <ProjectsPane /> : null}
          <ModulesPane />
        </>
      ) : null}
      <ModuleTabStrip />
      <textarea data-coach-anchor="story-add" aria-label="Capture an idea" />
      <div data-coach-anchor="workspace" tabIndex={-1}>
        Workspace
      </div>
    </>
  );
}

function renderTour(onSelectStory = vi.fn()) {
  return {
    onSelectStory,
    ...render(
      <>
        <TourSurface />
        <OnboardingTour onSelectStory={onSelectStory} />
      </>,
    ),
  };
}

function localProfile() {
  return {
    name: "Local",
    workspace_slug: "meml",
    agent_prompt: null,
    agent_prompts: {},
    module_links: [],
    recent_project_id: "project-created",
    recent_module_ids: {},
  };
}

function configResponse(profile = localProfile()): Response {
  return new Response(
    JSON.stringify({ recent_profile_index: 0, profiles: [profile] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/config/profiles/0" && init?.method === "PUT") {
      return Promise.resolve(
        configResponse(JSON.parse(String(init.body))),
      );
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  });
  workspaceApi.acknowledgeOnboarding.mockResolvedValue({
    id: "workspace-1",
    name: "Workspace",
    slug: "workspace",
    onboarding_required: false,
  });
  useTasksStore.setState((state) => ({
    projects: [],
    modules: [],
    selectedProjectId: null,
    selectedModuleId: null,
    loading: {
      ...state.loading,
      projects: false,
      modules: false,
    },
  }));
  useOnboardingTourStore.getState().reset();
  seedConfig({ profiles: [localProfile()], recentProfileIndex: 0 });
  startTourFromLayout(true, DEFAULT_PANEL_LAYOUT);
});

describe("post-project onboarding tour", () => {
  it("creates a module and Story and reaches the final step with the sidebar flag off without changing layout", async () => {
    startTourFromLayout(false, CUSTOM_PANEL_LAYOUT, {
      sidebar: false,
      projects: false,
    });
    const operations: string[] = [];
    const createModule = vi.fn(async () => {
      operations.push("create module");
      useTasksStore.setState({ selectedModuleId: "module-returned" });
      return "module-returned";
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/config/profiles/0" && init?.method === "PUT") {
        operations.push("store folder link");
        return Promise.resolve(configResponse(JSON.parse(String(init.body))));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    useTasksStore.setState({ createModule } as never);
    const { onSelectStory } = renderTour();

    expect(useClientStore.getState()).toMatchObject({
      sidebarVisible: false,
      panelLayout: CUSTOM_PANEL_LAYOUT,
    });
    expect(screen.queryByRole("dialog", { name: "Your projects" }))
      .not.toBeInTheDocument();
    expect(useOnboardingTourStore.getState().step).toBe("module-create");
    const moduleAnchor = screen.getByRole("button", { name: "Add module" });
    expect(document.querySelectorAll('[data-coach-anchor="module-add"]'))
      .toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Create your first module" }),
    ).toHaveAttribute("data-placement", "anchored");
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Create your first module" }),
      { key: "Escape" },
    );
    expect(moduleAnchor).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), {
      target: { value: " /repos/general " },
    });
    fireEvent.click(screen.getByTestId("onboarding-create-module"));

    const storyDialog = await screen.findByRole("dialog", {
      name: "Create your first story",
    });
    expect(storyDialog).toHaveAttribute("data-placement", "anchored");
    fireEvent.keyDown(storyDialog, { key: "Escape" });
    expect(screen.getByRole("textbox", { name: "Capture an idea" }))
      .toHaveFocus();
    expect(createModule).toHaveBeenCalledWith("project-created", "General");
    expect(operations).toEqual(["create module", "store folder link"]);
    expect(getConfigSnapshot().profiles[0]?.module_links).toEqual([
      { module_id: "module-returned", path: "/repos/general" },
    ]);
    expect(useTasksStore.getState().selectedModuleId).toBe("module-returned");
    expect(screen.queryByRole("dialog", { name: "Module Folder" }))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-story-name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-create-story")).not.toBeInTheDocument();

    useOnboardingTourStore.getState().storyCreated("story-returned");

    expect(
      await screen.findByRole("dialog", { name: "Your first story is ready" }),
    ).toHaveAttribute("data-placement", "anchored");
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Your first story is ready" }),
      { key: "Escape" },
    );
    expect(screen.getByText("Workspace")).toHaveFocus();
    await waitFor(() =>
      expect(onSelectStory).toHaveBeenCalledWith("story-returned"),
    );

    fireEvent.click(screen.getByTestId("onboarding-finish"));
    await waitFor(() =>
      expect(workspaceApi.acknowledgeOnboarding).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useClientStore.getState()).toMatchObject({
      sidebarVisible: false,
      panelLayout: CUSTOM_PANEL_LAYOUT,
    });
  });

  it.each([
    {
      features: { sidebar: true, projects: true },
      openingStep: "projects-pane",
      openingTitle: "Your projects",
    },
    {
      features: { sidebar: true, projects: false },
      openingStep: "module-create",
      openingTitle: "Create your first module",
    },
    {
      features: { sidebar: false, projects: false },
      openingStep: "module-create",
      openingTitle: "Create your first module",
    },
    {
      features: { sidebar: false, projects: true },
      openingStep: "module-create",
      openingTitle: "Create your first module",
    },
  ] as const)(
    "opens on $openingStep for features $features and keeps exactly one tab-strip module anchor",
    ({ features, openingStep, openingTitle }) => {
      startTourFromLayout(true, CUSTOM_PANEL_LAYOUT, features);
      renderTour();

      expect(useOnboardingTourStore.getState().step).toBe(openingStep);
      expect(screen.getByRole("dialog", { name: openingTitle })).toHaveAttribute(
        "data-placement",
        "anchored",
      );
      const moduleAnchor = screen.getByRole("button", { name: "Add module" });
      const moduleAnchors = document.querySelectorAll(
        '[data-coach-anchor="module-add"]',
      );
      expect(moduleAnchors).toHaveLength(1);
      expect(moduleAnchors[0]).toBe(moduleAnchor);

      if (openingStep === "projects-pane") {
        const projectAnchor = screen.getByRole("button", {
          name: "+ Add Project",
        });
        expect(document.querySelector('[data-coach-anchor="project-add"]'))
          .toBe(projectAnchor);
      } else {
        expect(screen.queryByRole("dialog", { name: "Your projects" }))
          .not.toBeInTheDocument();
        fireEvent.keyDown(
          screen.getByRole("dialog", { name: "Create your first module" }),
          { key: "Escape" },
        );
        expect(moduleAnchor).toHaveFocus();
      }
    },
  );

  it("requires trimmed module name and folder before enabling Create module", () => {
    renderTour();
    fireEvent.click(screen.getByTestId("onboarding-continue"));

    const name = screen.getByTestId("onboarding-module-name");
    const folder = screen.getByRole("textbox", { name: "Module folder" });
    const submit = screen.getByTestId("onboarding-create-module");
    expect(submit).toBeDisabled();

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.change(folder, { target: { value: "/repos/general" } });
    expect(submit).toBeDisabled();

    fireEvent.change(name, { target: { value: "General" } });
    fireEvent.change(folder, { target: { value: "   " } });
    expect(submit).toBeDisabled();

    fireEvent.change(folder, { target: { value: " /repos/general " } });
    expect(submit).toBeEnabled();
  });

  it("retries a failed folder link against the retained module without advancing or creating again", async () => {
    let folderWrites = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/config/profiles/0" || init?.method !== "PUT") {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      folderWrites += 1;
      if (folderWrites === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "save failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(configResponse(JSON.parse(String(init.body))));
    });
    const createModule = vi.fn(async () => {
      useTasksStore.setState({ selectedModuleId: "module-returned" });
      return "module-returned";
    });
    useTasksStore.setState({ createModule } as never);
    renderTour();
    fireEvent.click(screen.getByTestId("onboarding-continue"));
    fireEvent.change(screen.getByTestId("onboarding-module-name"), {
      target: { value: "My module" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), {
      target: { value: "/repos/my-module" },
    });

    fireEvent.click(screen.getByTestId("onboarding-create-module"));

    expect(await screen.findByTestId("onboarding-step-error")).toHaveTextContent(
      /folder could not be saved/i,
    );
    expect(useOnboardingTourStore.getState().step).toBe("module-create");
    expect(createModule).toHaveBeenCalledTimes(1);
    expect(folderWrites).toBe(1);

    fireEvent.click(screen.getByTestId("onboarding-create-module"));

    expect(
      await screen.findByRole("dialog", { name: "Create your first story" }),
    ).toBeInTheDocument();
    expect(createModule).toHaveBeenCalledTimes(1);
    expect(folderWrites).toBe(2);
  });

  it("retains the module value, step, and focus when creation fails so it can retry", async () => {
    const createModule = vi.fn(async () => {
      throw new Error("module unavailable");
    });
    useTasksStore.setState({ createModule } as never);
    renderTour();
    fireEvent.click(screen.getByTestId("onboarding-continue"));
    const input = screen.getByTestId("onboarding-module-name");
    fireEvent.change(input, { target: { value: "My module" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), {
      target: { value: "/repos/my-module" },
    });
    fireEvent.click(screen.getByTestId("onboarding-create-module"));

    expect(await screen.findByTestId("onboarding-step-error")).toHaveTextContent(
      "module unavailable",
    );
    expect(input).toHaveValue("My module");
    expect(input).toHaveFocus();
    expect(useOnboardingTourStore.getState().step).toBe("module-create");

    fireEvent.click(screen.getByTestId("onboarding-create-module"));
    await waitFor(() => expect(createModule).toHaveBeenCalledTimes(2));
  });

  it("ignores Story creation notifications outside the Story step", () => {
    useOnboardingTourStore.getState().storyCreated("unrelated-story");

    expect(useOnboardingTourStore.getState()).toMatchObject({
      step: "projects-pane",
      storyId: null,
    });
  });

  it.each(["projects-pane", "module-create", "story-create", "handoff"] as const)(
    "Skip at %s acknowledges and dismisses without creating a module",
    async (step) => {
      startTourFromLayout(false, CUSTOM_PANEL_LAYOUT);
      const createModule = vi.fn();
      useTasksStore.setState({ createModule } as never);
      useOnboardingTourStore.setState({
        step,
        projectId: "project-created",
        moduleId:
          step === "projects-pane" || step === "module-create"
            ? null
            : "module-returned",
        storyId: step === "handoff" ? "story-returned" : null,
      });
      renderTour();

      fireEvent.click(screen.getByTestId("onboarding-skip-tour"));
      await waitFor(() =>
        expect(workspaceApi.acknowledgeOnboarding).toHaveBeenCalledTimes(1),
      );
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
      expect(createModule).not.toHaveBeenCalled();
      expect(useClientStore.getState()).toMatchObject({
        sidebarVisible: false,
        panelLayout: CUSTOM_PANEL_LAYOUT,
      });
    },
  );

  it("leaves an already-default layout unchanged after the tour", async () => {
    renderTour();

    fireEvent.click(screen.getByTestId("onboarding-skip-tour"));

    await waitFor(() =>
      expect(workspaceApi.acknowledgeOnboarding).toHaveBeenCalledTimes(1),
    );
    expect(useClientStore.getState()).toMatchObject({
      sidebarVisible: true,
      panelLayout: DEFAULT_PANEL_LAYOUT,
    });
  });
});
