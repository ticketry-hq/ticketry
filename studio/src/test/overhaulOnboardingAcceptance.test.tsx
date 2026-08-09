import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...catalogApi,
}));

import OnboardingWelcome from "../app/onboarding/OnboardingWelcome";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";

const createProject = vi.fn();
const selectProject = vi.fn();
let releaseSelection = () => {};

describe("onboarding acceptance", () => {
  beforeEach(() => {
    catalogApi.getLaunchProviderCapabilities.mockReset().mockResolvedValue([]);
    catalogApi.getProviderCatalog.mockReset().mockResolvedValue({
      value: { activated_providers: [], global_default: null },
    });
    catalogApi.putProviderCatalog.mockReset().mockImplementation(async (value) => ({
      value,
    }));
    seedConfig({ features: { sidebar: true, projects: true } });
    useOnboardingTourStore.getState().reset();
    createProject.mockReset().mockResolvedValue({
      id: "created-project",
      name: "Coding",
      slug: "CDN",
      description: "",
    });
    selectProject.mockReset().mockImplementation(
      (id: string) => new Promise<void>((resolve) => {
        releaseSelection = () => {
          useStudioStore.setState({ selectedProjectId: id });
          resolve();
        };
      }),
    );
    useStudioStore.setState({
      selectedProjectId: null,
      createProjectWithError: createProject,
      selectProject,
    });
  });

  it("[overhaul-26] selects the first project before its guided tour starts", async () => {
    render(<OnboardingWelcome />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Your first project" });
    fireEvent.click(screen.getByTestId("onboarding-create-project"));

    await waitFor(() =>
      expect(selectProject).toHaveBeenCalledWith("created-project"),
    );
    expect(useOnboardingTourStore.getState().step).toBe("inactive");
    releaseSelection();
    await waitFor(() =>
      expect(useOnboardingTourStore.getState().step).toBe("projects-pane"),
    );
    expect(useStudioStore.getState().selectedProjectId).toBe("created-project");
    expect(useOnboardingTourStore.getState().projectId).toBe("created-project");
  });
});
