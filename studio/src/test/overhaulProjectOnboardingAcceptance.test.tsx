import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectApi = vi.hoisted(() => ({
  readOnboardingProjects: vi.fn(),
  acknowledgeOnboarding: vi.fn(),
}));

vi.mock("../features/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/projects")>()),
  ...projectApi,
}));

import { OnboardingGate } from "../app/onboarding/OnboardingGate";
import {
  acknowledgeOnboarding,
  loadOnboardingState,
} from "../app/onboarding/onboardingStore";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { studioApolloClient } from "../shared/apollo/client";

const project = (id: string, slug: string, onboarding_required: boolean) => ({
  id,
  slug,
  name: slug,
  onboarding_required,
});

function shell() {
  return render(
    <OnboardingGate>
      <div>App shell</div>
    </OnboardingGate>,
  );
}

/**
 * Onboarding is a Project responsibility. The Workspace row it used to live on
 * is gone from the schema, so the welcome, the acknowledgement, and the restart
 * all have to resolve through the installation project instead.
 */
describe("project-owned onboarding acceptance", () => {
  beforeEach(() => {
    projectApi.readOnboardingProjects.mockReset();
    projectApi.acknowledgeOnboarding.mockReset();
    studioApolloClient().cache.reset();
    useOnboardingTourStore.getState().reset();
  });

  it("[overhaul-170] resolves the welcome, its acknowledgement, and a restart through the installation project", async () => {
    // A first run has no project at all, which is the only state that can mean
    // onboarding has never happened.
    projectApi.readOnboardingProjects.mockResolvedValue([]);
    await loadOnboardingState();
    const firstRun = shell();
    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    firstRun.unmount();

    // Onboarding creates the installation project. Until it is acknowledged the
    // welcome keeps replacing the shell, and the project it belongs to is the
    // one carrying the recognized slug rather than the oldest row.
    projectApi.readOnboardingProjects.mockResolvedValue([
      project("older-project", "OLD", false),
      project("installation-project", "CDN", true),
    ]);
    await loadOnboardingState();
    const pending = shell();
    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    pending.unmount();

    // The acknowledgement names the project the tour ran for.
    projectApi.acknowledgeOnboarding.mockResolvedValue(
      project("installation-project", "CDN", false),
    );
    await acknowledgeOnboarding("installation-project");
    expect(projectApi.acknowledgeOnboarding).toHaveBeenCalledWith(
      "installation-project",
    );
    const acknowledged = shell();
    expect(screen.getByText("App shell")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    acknowledged.unmount();

    // A restart reads the acknowledged state back from the project.
    studioApolloClient().cache.reset();
    projectApi.readOnboardingProjects.mockResolvedValue([
      project("older-project", "OLD", false),
      project("installation-project", "CDN", false),
    ]);
    await loadOnboardingState();
    shell();
    expect(screen.getByText("App shell")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
  });
});
