import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));
const resolveDefaultProject = vi.hoisted(() => vi.fn());

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...catalogApi,
}));
vi.mock("../features/studio/lib/defaultProject", () => ({
  resolveDefaultProject,
}));

import OnboardingWelcome from "../app/onboarding/OnboardingWelcome";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { useStudioStore } from "../features/projects/store";
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
    useOnboardingTourStore.getState().reset();
    resolveDefaultProject.mockReset().mockResolvedValue({
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
      selectProject,
    });
  });

  it("[overhaul-26] selects the first project before its guided tour starts", async () => {
    render(<OnboardingWelcome />);

    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() =>
      expect(selectProject).toHaveBeenCalledWith("created-project"),
    );
    expect(useOnboardingTourStore.getState().step).toBe("inactive");
    releaseSelection();
    await waitFor(() =>
      expect(useOnboardingTourStore.getState().step).toBe("module-create"),
    );
    expect(useStudioStore.getState().selectedProjectId).toBe("created-project");
    expect(useOnboardingTourStore.getState().projectId).toBe("created-project");
  });
});
