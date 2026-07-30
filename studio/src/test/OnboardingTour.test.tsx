import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingTour from "../app/onboarding/OnboardingTour";
import { useOnboardingStore } from "../app/onboarding/onboardingStore";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { DEFAULT_PANEL_LAYOUT } from "../app/studio/layout/layoutMath";
import { ModuleTabStrip } from "../features/studio/components/ModuleTabStrip";
import { ModulesPane } from "../features/studio/pages/modules/ModulesPane";
import { ProjectsPane } from "../features/studio/pages/projects/ProjectsPane";
import {
  isSidebarEnabled,
  useConfigStore,
} from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";

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
  useConfigStore.setState({ features });
  useUIStore.setState({ sidebarVisible, panelLayout });
  useOnboardingTourStore.getState().start("project-created");
}

function TourSurface() {
  const sidebarEnabled = useConfigStore((state) => isSidebarEnabled(state));
  const projectsEnabled = useConfigStore((state) => state.features.projects);

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

beforeEach(() => {
  vi.clearAllMocks();
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
  startTourFromLayout(true, DEFAULT_PANEL_LAYOUT);
});

describe("post-project onboarding tour", () => {
  it("creates a module and Story and reaches the final step with the sidebar flag off without changing layout", async () => {
    startTourFromLayout(false, CUSTOM_PANEL_LAYOUT, {
      sidebar: false,
      projects: false,
    });
    const createModule = vi.fn(async () => {
      useTasksStore.setState({ selectedModuleId: "module-returned" });
    });
    const acknowledgeOnboarding = vi.fn(async () => undefined);
    useTasksStore.setState({ createModule } as never);
    useOnboardingStore.setState({ acknowledgeOnboarding } as never);
    const { onSelectStory } = renderTour();

    expect(useUIStore.getState()).toMatchObject({
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
    fireEvent.click(screen.getByTestId("onboarding-create-module"));

    const storyDialog = await screen.findByRole("dialog", {
      name: "Create your first story",
    });
    expect(storyDialog).toHaveAttribute("data-placement", "anchored");
    fireEvent.keyDown(storyDialog, { key: "Escape" });
    expect(screen.getByRole("textbox", { name: "Capture an idea" }))
      .toHaveFocus();
    expect(createModule).toHaveBeenCalledWith("project-created", "General");
    expect(useTasksStore.getState().selectedModuleId).toBe("module-returned");
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
    await waitFor(() => expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useUIStore.getState()).toMatchObject({
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

  it("retains the module value, step, and focus when creation fails so it can retry", async () => {
    const createModule = vi.fn(async () => {
      throw new Error("module unavailable");
    });
    useTasksStore.setState({ createModule } as never);
    renderTour();
    fireEvent.click(screen.getByTestId("onboarding-continue"));
    const input = screen.getByTestId("onboarding-module-name");
    fireEvent.change(input, { target: { value: "My module" } });
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
      const acknowledgeOnboarding = vi.fn(async () => undefined);
      const createModule = vi.fn();
      useTasksStore.setState({ createModule } as never);
      useOnboardingStore.setState({ acknowledgeOnboarding } as never);
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
      await waitFor(() => expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1));
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
      expect(createModule).not.toHaveBeenCalled();
      expect(useUIStore.getState()).toMatchObject({
        sidebarVisible: false,
        panelLayout: CUSTOM_PANEL_LAYOUT,
      });
    },
  );

  it("leaves an already-default layout unchanged after the tour", async () => {
    const acknowledgeOnboarding = vi.fn(async () => undefined);
    useOnboardingStore.setState({ acknowledgeOnboarding } as never);
    renderTour();

    fireEvent.click(screen.getByTestId("onboarding-skip-tour"));

    await waitFor(() => expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1));
    expect(useUIStore.getState()).toMatchObject({
      sidebarVisible: true,
      panelLayout: DEFAULT_PANEL_LAYOUT,
    });
  });
});
