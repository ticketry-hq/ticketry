import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectApi = vi.hoisted(() => ({
  readWorkspace: vi.fn(),
  acknowledgeOnboarding: vi.fn(),
}));
const catalogApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../features/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/projects")>()),
  ...projectApi,
}));

import { OnboardingGate } from "../app/onboarding/OnboardingGate";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { WorkTrackerWorkspaceDocument } from "../features/projects/generated/projects.documents";
import { studioApolloClient } from "../shared/apollo/client";

function seedWorkspace(onboardingRequired: boolean): void {
  const data = {
    workspace: {
      __typename: "WorktrackerWorkspaceConnection",
      nodes: [{
        __typename: "WorktrackerWorkspace",
        id: "w1",
        name: "MEML",
        slug: "meml",
        onboarding_required: onboardingRequired,
      }],
    },
  };
  studioApolloClient().writeQuery({
    query: WorkTrackerWorkspaceDocument,
    data,
  });
}

beforeEach(() => {
  catalogApi.getLaunchProviderCapabilities.mockReset().mockResolvedValue([]);
  catalogApi.getProviderCatalog.mockReset().mockResolvedValue({
    value: { activated_providers: [], global_default: null },
  });
  catalogApi.putProviderCatalog.mockReset().mockImplementation(async (value) => ({
    value,
  }));
  projectApi.acknowledgeOnboarding.mockReset().mockResolvedValue({
    id: "w1",
    name: "MEML",
    slug: "meml",
    onboarding_required: false,
  });
  seedWorkspace(false);
  useOnboardingTourStore.getState().reset();
});

describe("OnboardingGate", () => {
  it("renders the app shell directly when onboarding is not required", () => {
    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(screen.getByText("App shell")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
  });

  it("substitutes the onboarding surface for the app shell while required", () => {
    seedWorkspace(true);

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    expect(screen.queryByText("App shell")).not.toBeInTheDocument();
  });

  it("hands off to the app shell while the guided tour is active", () => {
    seedWorkspace(true);
    useOnboardingTourStore.getState().start("created-project");

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(screen.getByText("App shell")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    expect(studioApolloClient().readQuery({ query: WorkTrackerWorkspaceDocument })
      ?.workspace.nodes[0]?.onboarding_required).toBe(true);
  });

  it("does not offer a way to skip required onboarding", () => {
    seedWorkspace(true);

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(
      screen.queryByRole("button", { name: "Skip" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    expect(screen.queryByText("App shell")).not.toBeInTheDocument();
    expect(projectApi.acknowledgeOnboarding).not.toHaveBeenCalled();
  });
});
