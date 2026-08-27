import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../features/projects", async () => {
  const actual = await vi.importActual<typeof import("../features/projects")>(
    "../features/projects",
  );
  return {
    ...actual,
    readWorkspace: vi.fn(),
    acknowledgeOnboarding: vi.fn(),
  };
});

import * as api from "../features/projects";
import {
  acknowledgeOnboarding as acknowledgeOnboardingAction,
  getOnboardingRequiredSnapshot,
  loadWorkspaceState,
} from "../app/onboarding/onboardingStore";
import { WorkTrackerWorkspaceDocument } from "../features/projects/generated/projects.documents";
import { studioApolloClient } from "../shared/apollo/client";

const getWorkspace = api.readWorkspace as ReturnType<typeof vi.fn>;
const acknowledgeOnboarding = api.acknowledgeOnboarding as ReturnType<typeof vi.fn>;

const workspace = (onboarding_required: boolean) => ({
  id: "w1",
  name: "MEML",
  slug: "meml",
  onboarding_required,
});

function seedWorkspace(onboardingRequired: boolean): void {
  const data = {
    workspace: {
      __typename: "WorktrackerWorkspaceConnection",
      nodes: [{
        __typename: "WorktrackerWorkspace",
        ...workspace(onboardingRequired),
      }],
    },
  };
  studioApolloClient().writeQuery({ query: WorkTrackerWorkspaceDocument, data });
}

beforeEach(() => {
  getWorkspace.mockReset();
  acknowledgeOnboarding.mockReset();
  seedWorkspace(false);
});

describe("onboardingStore", () => {
  it("maps the workspace flag onto onboardingRequired", async () => {
    getWorkspace.mockResolvedValue(workspace(true));
    await loadWorkspaceState();
    expect(getOnboardingRequiredSnapshot()).toBe(true);

    getWorkspace.mockResolvedValue(workspace(false));
    await loadWorkspaceState();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("swallows a failing load: resolves and leaves onboarding not required", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    seedWorkspace(true);
    getWorkspace.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      loadWorkspaceState(),
    ).resolves.toBeUndefined();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("acknowledgement clears onboardingRequired", async () => {
    seedWorkspace(true);
    acknowledgeOnboarding.mockResolvedValue(workspace(false));

    await acknowledgeOnboardingAction();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
    expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1);
  });
});
