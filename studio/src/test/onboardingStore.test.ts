import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../features/projects", async () => {
  const actual = await vi.importActual<typeof import("../features/projects")>(
    "../features/projects",
  );
  return {
    ...actual,
    readOnboardingProjects: vi.fn(),
    acknowledgeOnboarding: vi.fn(),
  };
});

import * as api from "../features/projects";
import {
  acknowledgeOnboarding as acknowledgeOnboardingAction,
  getOnboardingRequiredSnapshot,
  loadOnboardingState,
} from "../app/onboarding/onboardingStore";
import { WorkTrackerOnboardingDocument } from "../features/projects/generated/projects.documents";
import { studioApolloClient } from "../shared/apollo/client";

const getOnboardingProjects = api.readOnboardingProjects as ReturnType<typeof vi.fn>;
const acknowledgeOnboarding = api.acknowledgeOnboarding as ReturnType<typeof vi.fn>;

const project = (
  id: string,
  slug: string,
  onboarding_required: boolean,
) => ({ id, slug, name: slug, onboarding_required });

function seed(nodes: ReturnType<typeof project>[]): void {
  const data = {
    projects: {
      __typename: "WorktrackerProjectConnection",
      nodes: nodes.map((node) => ({
        __typename: "WorktrackerProject",
        ...node,
      })),
    },
  };
  studioApolloClient().writeQuery({ query: WorkTrackerOnboardingDocument, data });
}

beforeEach(() => {
  getOnboardingProjects.mockReset();
  acknowledgeOnboarding.mockReset();
  studioApolloClient().cache.reset();
  seed([project("p1", "CDN", false)]);
});

describe("onboardingStore", () => {
  it("maps the installation project's flag onto onboardingRequired", async () => {
    getOnboardingProjects.mockResolvedValue([project("p1", "CDN", true)]);
    await loadOnboardingState();
    expect(getOnboardingRequiredSnapshot()).toBe(true);

    getOnboardingProjects.mockResolvedValue([project("p1", "CDN", false)]);
    await loadOnboardingState();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("prefers the recognized installation slug over an older project", async () => {
    getOnboardingProjects.mockResolvedValue([
      project("p1", "OLD", true),
      project("p2", "CDN", false),
    ]);

    await loadOnboardingState();

    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("falls back to the oldest project when no slug is recognized", async () => {
    getOnboardingProjects.mockResolvedValue([
      project("p1", "ONE", true),
      project("p2", "TWO", false),
    ]);

    await loadOnboardingState();

    expect(getOnboardingRequiredSnapshot()).toBe(true);
  });

  it("treats an installation with no project as a pending first run", async () => {
    getOnboardingProjects.mockResolvedValue([]);

    await loadOnboardingState();

    expect(getOnboardingRequiredSnapshot()).toBe(true);
  });

  it("swallows a failing load: resolves and leaves onboarding not required", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    studioApolloClient().cache.reset();
    getOnboardingProjects.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(loadOnboardingState()).resolves.toBeUndefined();

    // An unreadable installation must not be mistaken for a first run.
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("acknowledgement names the project it clears", async () => {
    seed([project("p1", "CDN", true)]);
    acknowledgeOnboarding.mockResolvedValue(project("p1", "CDN", false));

    await acknowledgeOnboardingAction("p1");

    expect(getOnboardingRequiredSnapshot()).toBe(false);
    expect(acknowledgeOnboarding).toHaveBeenCalledWith("p1");
  });

  it("acknowledging a project the cache has not seen adds it", async () => {
    studioApolloClient().cache.reset();
    acknowledgeOnboarding.mockResolvedValue(project("p9", "CDN", false));

    await acknowledgeOnboardingAction("p9");

    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });
});
