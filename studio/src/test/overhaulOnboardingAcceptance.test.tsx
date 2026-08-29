import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));
const providerState = vi.hoisted(() => ({
  catalog: { activated_providers: [] as string[], global_default: null },
  capabilities: [] as unknown[],
}));

vi.mock("./legacyApiFixture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./legacyApiFixture")>()),
  ...catalogApi,
}));

vi.mock("../features/studio/lib/defaultProject", async () => ({
  ...(await vi.importActual("../features/studio/lib/defaultProject")),
  resolveDefaultProject: vi.fn(),
}));

vi.mock("../features/workflows/providerQueries", () => ({
  setProviderCapabilities: vi.fn(),
  loadProviderCapabilities: catalogApi.getLaunchProviderCapabilities,
  loadConfigurableProviderCapabilities: catalogApi.getLaunchProviderCapabilities,
  loadProviderCatalog: async () => (await catalogApi.getProviderCatalog()).value,
  updateProviderCatalog: async (value: unknown) =>
    (await catalogApi.putProviderCatalog(value)).value,
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

import OnboardingWelcome from "../app/onboarding/OnboardingWelcome";
import * as defaultProject from "../features/studio/lib/defaultProject";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { useStudioStore } from "../features/projects/store";

const resolveDefaultProject =
  defaultProject.resolveDefaultProject as ReturnType<typeof vi.fn>;
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
      id: "installation-project",
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
    useStudioStore.setState({ selectedProjectId: null, selectProject });
  });

  it("[overhaul-26] selects the installation project before its guided tour starts", async () => {
    render(<OnboardingWelcome />);

    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("checkbox", { name: "I use codex" }));
    // One installation project: nobody is asked to name or choose one.
    expect(screen.queryByRole("heading", { name: "Your first project" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() =>
      expect(selectProject).toHaveBeenCalledWith("installation-project"),
    );
    expect(useOnboardingTourStore.getState().step).toBe("inactive");
    releaseSelection();
    await waitFor(() =>
      expect(useOnboardingTourStore.getState().step).toBe("module-create"),
    );
    expect(useStudioStore.getState().selectedProjectId).toBe("installation-project");
    expect(useOnboardingTourStore.getState().projectId).toBe("installation-project");
  });

  it("keeps a provider selection when a late catalog response repeats the initial value", async () => {
    const view = render(<OnboardingWelcome />);
    const codex = await screen.findByRole("checkbox", { name: "I use codex" });

    fireEvent.click(codex);
    expect(codex).toBeChecked();

    providerState.catalog = {
      activated_providers: [],
      global_default: null,
    };
    view.rerender(<OnboardingWelcome />);

    expect(codex).toBeChecked();
  });
});
