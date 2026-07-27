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
import { useOnboardingStore } from "../app/onboarding/onboardingStore";

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
  useOnboardingStore.setState({ onboardingRequired: false });
});

describe("onboardingStore", () => {
  it("maps the workspace flag onto onboardingRequired", async () => {
    getWorkspace.mockResolvedValue(workspace(true));
    await useOnboardingStore.getState().loadWorkspaceState();
    expect(useOnboardingStore.getState().onboardingRequired).toBe(true);

    getWorkspace.mockResolvedValue(workspace(false));
    await useOnboardingStore.getState().loadWorkspaceState();
    expect(useOnboardingStore.getState().onboardingRequired).toBe(false);
  });

  it("swallows a failing load: resolves and leaves onboarding not required", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useOnboardingStore.setState({ onboardingRequired: true });
    getWorkspace.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      useOnboardingStore.getState().loadWorkspaceState(),
    ).resolves.toBeUndefined();
    expect(useOnboardingStore.getState().onboardingRequired).toBe(false);
  });

  it("acknowledgement clears onboardingRequired", async () => {
    useOnboardingStore.setState({ onboardingRequired: true });
    acknowledgeOnboarding.mockResolvedValue(workspace(false));

    await useOnboardingStore.getState().acknowledgeOnboarding();
    expect(useOnboardingStore.getState().onboardingRequired).toBe(false);
    expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1);
  });
});
