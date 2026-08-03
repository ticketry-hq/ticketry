import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    getWorkspace: vi.fn(),
    acknowledgeOnboarding: vi.fn(),
  };
});

import * as api from "../shared/api/client";
import {
  acknowledgeOnboarding as acknowledgeOnboardingAction,
  getOnboardingRequiredSnapshot,
  loadWorkspaceState,
} from "../app/onboarding/onboardingStore";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";

const getWorkspace = api.getWorkspace as ReturnType<typeof vi.fn>;
const acknowledgeOnboarding = api.acknowledgeOnboarding as ReturnType<typeof vi.fn>;

const workspace = (onboarding_required: boolean) => ({
  id: "w1",
  name: "MEML",
  slug: "meml",
  onboarding_required,
});

beforeEach(() => {
  getWorkspace.mockReset();
  acknowledgeOnboarding.mockReset();
  queryClient.setQueryData(queryKeys.workspace, false);
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
    queryClient.setQueryData(queryKeys.workspace, true);
    getWorkspace.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      loadWorkspaceState(),
    ).resolves.toBeUndefined();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("acknowledgement clears onboardingRequired", async () => {
    queryClient.setQueryData(queryKeys.workspace, true);
    acknowledgeOnboarding.mockResolvedValue(workspace(false));

    await acknowledgeOnboardingAction();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
    expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1);
  });
});
