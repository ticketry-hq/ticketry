import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    listProjects: vi.fn(),
    acknowledgeProjectOnboarding: vi.fn(),
  };
});

import * as api from "../shared/api/client";
import {
  acknowledgeOnboarding as acknowledgeOnboardingAction,
  getOnboardingRequiredSnapshot,
  loadProjectOnboardingState,
} from "../app/onboarding/onboardingStore";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";

const listProjects = api.listProjects as ReturnType<typeof vi.fn>;
const acknowledgeProjectOnboarding = api.acknowledgeProjectOnboarding as ReturnType<typeof vi.fn>;

const project = (onboarding_required: boolean) => ({
  id: "p1",
  name: "Coding",
  slug: "CDN",
  description: "",
  onboarding_required,
});

beforeEach(() => {
  listProjects.mockReset();
  acknowledgeProjectOnboarding.mockReset();
  queryClient.clear();
  queryClient.setQueryData(queryKeys.onboarding, false);
});

describe("onboardingStore", () => {
  it("maps the default project's flag onto onboardingRequired", async () => {
    listProjects.mockResolvedValue([project(true)]);
    await loadProjectOnboardingState();
    expect(getOnboardingRequiredSnapshot()).toBe(true);

    listProjects.mockResolvedValue([project(false)]);
    await loadProjectOnboardingState();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("swallows a failing load: resolves and leaves onboarding not required", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    queryClient.setQueryData(queryKeys.onboarding, true);
    listProjects.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      loadProjectOnboardingState(),
    ).resolves.toBeUndefined();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
  });

  it("acknowledgement clears onboardingRequired", async () => {
    listProjects.mockResolvedValue([project(true)]);
    await loadProjectOnboardingState();
    queryClient.setQueryData(queryKeys.onboarding, true);
    acknowledgeProjectOnboarding.mockResolvedValue(project(false));

    await acknowledgeOnboardingAction();
    expect(getOnboardingRequiredSnapshot()).toBe(false);
    expect(acknowledgeProjectOnboarding).toHaveBeenCalledWith("p1");
  });
});
