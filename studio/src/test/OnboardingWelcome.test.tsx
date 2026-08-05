import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderCatalog } from "../shared/api/types";

const catalogApi = vi.hoisted(() => ({
  createProject: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  ...catalogApi,
}));

import OnboardingWelcome from "../app/onboarding/OnboardingWelcome";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { getOnboardingRequiredSnapshot } from "../app/onboarding/onboardingStore";
import { seedConfig } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import * as workspaceApi from "../shared/api/client";
import { ApiError } from "../shared/api/client";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    acknowledgeOnboarding: vi.fn(),
    listModules: vi.fn(),
    listProjects: vi.fn(),
  };
});

const capabilities = [
  {
    agent: "claude",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: ["sonnet"],
    model_prefixes: ["claude-"],
    reasoning_levels: ["low", "high"],
  },
  {
    agent: "codex",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: [],
    model_prefixes: ["gpt-"],
    reasoning_levels: ["medium", "xhigh"],
  },
  {
    agent: "gemini",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: [],
    model_prefixes: ["gemini-"],
    reasoning_levels: [],
  },
];

const emptyCatalog: ProviderCatalog = {
  activated_providers: [],
  global_default: null,
};

const acknowledgeOnboarding = workspaceApi.acknowledgeOnboarding as ReturnType<
  typeof vi.fn
>;
const listModules = workspaceApi.listModules as ReturnType<typeof vi.fn>;
const listProjects = workspaceApi.listProjects as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  catalogApi.createProject.mockResolvedValue({
    id: "created-project",
    name: "Coding",
    identifier: "CODING",
  });
  catalogApi.getLaunchProviderCapabilities.mockResolvedValue(capabilities);
  catalogApi.getProviderCatalog.mockResolvedValue({ value: emptyCatalog });
  catalogApi.putProviderCatalog.mockImplementation(
    async (value: ProviderCatalog) => ({ value }),
  );
  acknowledgeOnboarding.mockResolvedValue({
    id: "w1",
    name: "MEML",
    slug: "meml",
    onboarding_required: false,
  });
  listModules.mockResolvedValue([]);
  listProjects.mockResolvedValue([]);
  queryClient.setQueryData(queryKeys.workspace, true);
  useOnboardingTourStore.getState().reset();
  seedConfig({
    features: { sidebar: true, projects: true },
  });
  useTasksStore.setState({ projects: [], selectedProjectId: null });
});

describe("Onboarding welcome", () => {
  it("uses provider setup as the entire welcome flow when Projects is disabled", async () => {
    seedConfig({ features: { sidebar: true, projects: false } });
    useTasksStore.setState({
      projects: [
        { id: "bootstrap-project", name: "Coding", identifier: "CDN" },
      ],
      selectedProjectId: "bootstrap-project",
    });

    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    expect(screen.getByRole("button", { name: "Get started" }))
      .toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Your first project" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => {
      expect(useOnboardingTourStore.getState()).toMatchObject({
        step: "module-create",
        projectId: "bootstrap-project",
      });
    });
    expect(catalogApi.createProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Your first project" }))
      .not.toBeInTheDocument();
  });

  it("resolves and selects the canonical default before starting without Projects", async () => {
    seedConfig({ features: { sidebar: true, projects: false } });
    useTasksStore.setState({
      projects: [
        { id: "legacy-project", name: "Legacy", identifier: "CODING" },
        { id: "canonical-project", name: "Coding", identifier: "CDN" },
      ],
      selectedProjectId: null,
    });

    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });
    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => {
      expect(useTasksStore.getState().selectedProjectId)
        .toBe("canonical-project");
      expect(useOnboardingTourStore.getState()).toMatchObject({
        step: "module-create",
        projectId: "canonical-project",
      });
    });
    expect(catalogApi.createProject).not.toHaveBeenCalled();
  });

  it("creates canonical Coding only as fallback before starting without Projects", async () => {
    seedConfig({ features: { sidebar: true, projects: false } });
    catalogApi.createProject.mockResolvedValueOnce({
      id: "created-canonical-project",
      name: "Coding",
      identifier: "CDN",
    });

    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });
    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => {
      expect(catalogApi.createProject).toHaveBeenCalledWith({
        name: "Coding",
        slug: "CDN",
      });
      expect(useOnboardingTourStore.getState()).toMatchObject({
        step: "module-create",
        projectId: "created-canonical-project",
      });
    });
  });

  it("keeps default-project failures inline and retries without a null tour", async () => {
    seedConfig({ features: { sidebar: true, projects: false } });
    catalogApi.createProject.mockRejectedValueOnce(new Error("create failed"));

    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });
    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The resolved default project is unavailable.",
    );
    expect(useOnboardingTourStore.getState()).toMatchObject({
      step: "inactive",
      projectId: null,
    });
    expect(screen.getByRole("button", { name: "Get started" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => {
      expect(catalogApi.createProject).toHaveBeenCalledTimes(2);
      expect(useOnboardingTourStore.getState()).toMatchObject({
        step: "module-create",
        projectId: "created-project",
      });
    });
  });

  it("does not treat the backend's legacy first-run defaults as declarations", async () => {
    catalogApi.getProviderCatalog.mockResolvedValue({
      value: {
        activated_providers: ["claude", "codex", "gemini"],
        global_default: null,
      },
    });

    render(<OnboardingWelcome />);

    await screen.findByRole("heading", { name: "Your agents" });
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "I use claude" }))
        .not.toBeChecked();
    });
    expect(screen.getByRole("checkbox", { name: "I use codex" }))
      .not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "I use gemini" }))
      .not.toBeChecked();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("requires at least one declared agent subscription", async () => {
    render(<OnboardingWelcome />);

    expect(await screen.findByRole("heading", { name: "Your agents" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Agent/provider" }))
      .not.toBeInTheDocument();
    expect(catalogApi.putProviderCatalog).not.toHaveBeenCalled();
  });

  it("silently makes one declared provider the complete global default", async () => {
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));

    expect(screen.queryByRole("combobox", { name: "Agent/provider" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(catalogApi.putProviderCatalog).toHaveBeenCalledWith({
        activated_providers: ["codex"],
        global_default: {
          provider: "codex",
          model: null,
          reasoning: null,
        },
      });
    });
    expect(await screen.findByRole("heading", { name: "Your first project" }))
      .toBeInTheDocument();
  });

  it("requires and saves a valid default when several providers are declared", async () => {
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("checkbox", { name: "I use claude" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));

    const provider = screen.getByRole("combobox", { name: "Agent/provider" });
    expect(provider).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "gemini" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    fireEvent.change(provider, { target: { value: "claude" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "sonnet" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(catalogApi.putProviderCatalog).toHaveBeenCalledWith({
        activated_providers: ["claude", "codex"],
        global_default: {
          provider: "claude",
          model: "sonnet",
          reasoning: "high",
        },
      });
    });
  });

  it("reports an incompatible model before continuing", async () => {
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("checkbox", { name: "I use claude" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I use gemini" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Agent/provider" }),
      { target: { value: "gemini" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "sonnet" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Model 'sonnet' is not compatible with agent/provider 'gemini'.",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(catalogApi.putProviderCatalog).not.toHaveBeenCalled();
  });

  it("skip acknowledges onboarding with no providers activated", async () => {
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(catalogApi.putProviderCatalog).toHaveBeenCalledWith(emptyCatalog);
      expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1);
    });
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("keeps the same skip acknowledgement when Projects is disabled", async () => {
    seedConfig({ features: { sidebar: true, projects: false } });
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(catalogApi.putProviderCatalog).toHaveBeenCalledWith(emptyCatalog);
      expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1);
    });
    expect(getOnboardingRequiredSnapshot()).toBe(false);
    expect(catalogApi.createProject).not.toHaveBeenCalled();
    expect(useOnboardingTourStore.getState().step).toBe("inactive");
  });

  it("skip remains available after provider setup", async () => {
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Your first project" });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(catalogApi.putProviderCatalog).toHaveBeenLastCalledWith(emptyCatalog);
      expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1);
    });
    expect(catalogApi.createProject).not.toHaveBeenCalled();
  });

  it("creates the independently editable first project through the live store and starts its tour", async () => {
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Your first project" });

    const name = screen.getByTestId("onboarding-project-name");
    const key = screen.getByTestId("onboarding-project-key");
    expect(name).toHaveValue("Coding");
    expect(key).toHaveValue("CDN");
    expect(key).toHaveAttribute("maxlength", "3");
    expect(screen.getByText(
      "Project key must be exactly three letters, using only A-Z.",
    )).toBeInTheDocument();

    fireEvent.change(name, { target: { value: "My project" } });
    expect(key).toHaveValue("CDN");
    fireEvent.change(key, { target: { value: "" } });
    expect(name).toHaveValue("My project");
    expect(screen.getByTestId("onboarding-create-project")).toBeDisabled();

    fireEvent.change(key, { target: { value: "MYP" } });
    fireEvent.click(screen.getByTestId("onboarding-create-project"));

    await waitFor(() => {
      expect(catalogApi.createProject).toHaveBeenCalledWith({
        name: "My project",
        slug: "MYP",
        description: "",
      });
      expect(useTasksStore.getState().projects).toEqual([
        {
          id: "created-project",
          name: "Coding",
          identifier: "CODING",
        },
      ]);
      expect(useOnboardingTourStore.getState()).toMatchObject({
        step: "projects-pane",
        projectId: "created-project",
      });
    });
    expect(getOnboardingRequiredSnapshot()).toBe(true);
    expect(acknowledgeOnboarding).not.toHaveBeenCalled();
  });

  it("shows a duplicate-key conflict inline and keeps the project form editable", async () => {
    catalogApi.createProject.mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        detail: "Project slug 'CDN' already exists.",
      }),
    );
    render(<OnboardingWelcome />);
    await screen.findByRole("heading", { name: "Your agents" });

    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Your first project" });
    fireEvent.click(screen.getByTestId("onboarding-create-project"));

    expect(await screen.findByTestId("onboarding-create-error"))
      .toHaveTextContent("Project slug 'CDN' already exists.");
    expect(screen.getByTestId("onboarding-project-name")).toHaveValue("Coding");
    expect(screen.getByTestId("onboarding-project-key")).toHaveValue("CDN");

    fireEvent.change(screen.getByTestId("onboarding-project-key"), {
      target: { value: "NEW" },
    });
    expect(screen.getByTestId("onboarding-create-project")).toBeEnabled();
  });
});
