import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingTour from "../app/onboarding/OnboardingTour";
import { useOnboardingStore } from "../app/onboarding/onboardingStore";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { DEFAULT_PANEL_LAYOUT } from "../app/studio/layout/layoutMath";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";

const CUSTOM_PANEL_LAYOUT = [12, 24, 40, 24];

function startTourFromLayout(
  sidebarVisible: boolean,
  panelLayout: number[] | null,
) {
  useOnboardingTourStore.getState().reset();
  useUIStore.setState({ sidebarVisible, panelLayout });
  useOnboardingTourStore.getState().start("project-created");
}

function renderTour(onSelectStory = vi.fn()) {
  return {
    onSelectStory,
    ...render(
      <>
        <button data-coach-anchor="project-add">+ Add Project</button>
        <button data-coach-anchor="module-add">+ Add Module</button>
        <textarea data-coach-anchor="story-add" aria-label="Capture an idea" />
        <div data-coach-anchor="workspace">Workspace</div>
        <OnboardingTour onSelectStory={onSelectStory} />
      </>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTasksStore.setState({ selectedModuleId: null });
  useOnboardingTourStore.getState().reset();
  startTourFromLayout(true, DEFAULT_PANEL_LAYOUT);
});

describe("post-project onboarding tour", () => {
  it("runs four anchored steps, creates and selects a module, then advances on real Story creation", async () => {
    startTourFromLayout(false, CUSTOM_PANEL_LAYOUT);
    const createModule = vi.fn(async () => {
      useTasksStore.setState({ selectedModuleId: "module-returned" });
    });
    const acknowledgeOnboarding = vi.fn(async () => undefined);
    useTasksStore.setState({ createModule } as never);
    useOnboardingStore.setState({ acknowledgeOnboarding } as never);
    const { onSelectStory } = renderTour();

    expect(useUIStore.getState()).toMatchObject({
      sidebarVisible: true,
      panelLayout: DEFAULT_PANEL_LAYOUT,
    });
    expect(screen.getByRole("dialog", { name: "Your projects" })).toHaveAttribute(
      "data-placement",
      "anchored",
    );

    fireEvent.click(screen.getByTestId("onboarding-continue"));
    expect(
      screen.getByRole("dialog", { name: "Create your first module" }),
    ).toHaveAttribute("data-placement", "anchored");
    fireEvent.click(screen.getByTestId("onboarding-create-module"));

    expect(
      await screen.findByRole("dialog", { name: "Create your first story" }),
    ).toHaveAttribute("data-placement", "anchored");
    expect(createModule).toHaveBeenCalledWith("project-created", "General");
    expect(useTasksStore.getState().selectedModuleId).toBe("module-returned");
    expect(screen.queryByTestId("onboarding-story-name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-create-story")).not.toBeInTheDocument();

    useOnboardingTourStore.getState().storyCreated("story-returned");

    expect(
      await screen.findByRole("dialog", { name: "Your first story is ready" }),
    ).toHaveAttribute("data-placement", "anchored");
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
