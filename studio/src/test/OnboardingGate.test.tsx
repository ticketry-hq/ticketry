import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  ...catalogApi,
}));

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
import { OnboardingGate } from "../app/onboarding/OnboardingGate";
import { useOnboardingStore } from "../app/onboarding/onboardingStore";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";

const acknowledgeOnboarding = api.acknowledgeOnboarding as ReturnType<typeof vi.fn>;

beforeEach(() => {
  catalogApi.getLaunchProviderCapabilities.mockReset().mockResolvedValue([]);
  catalogApi.getProviderCatalog.mockReset().mockResolvedValue({
    value: { activated_providers: [], global_default: null },
  });
  catalogApi.putProviderCatalog.mockReset().mockImplementation(async (value) => ({
    value,
  }));
  acknowledgeOnboarding.mockReset().mockResolvedValue({
    id: "w1",
    name: "MEML",
    slug: "meml",
    onboarding_required: false,
  });
  useOnboardingStore.setState({ onboardingRequired: false });
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
    useOnboardingStore.setState({ onboardingRequired: true });

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    expect(screen.queryByText("App shell")).not.toBeInTheDocument();
  });

  it("hands off to the app shell while the guided tour is active", () => {
    useOnboardingStore.setState({ onboardingRequired: true });
    useOnboardingTourStore.getState().start("created-project");

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(screen.getByText("App shell")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    expect(useOnboardingStore.getState().onboardingRequired).toBe(true);
  });

  it("skip acknowledges onboarding and reveals the app shell", async () => {
    useOnboardingStore.setState({ onboardingRequired: true });

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    fireEvent.click(screen.getByTestId("onboarding-skip"));

    expect(await screen.findByText("App shell")).toBeInTheDocument();
    expect(acknowledgeOnboarding).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
  });

  it("keeps the surface with an inline error when acknowledgement fails", async () => {
    useOnboardingStore.setState({ onboardingRequired: true });
    acknowledgeOnboarding.mockRejectedValue(new Error("boom"));

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    fireEvent.click(screen.getByTestId("onboarding-skip"));

    await waitFor(() =>
      expect(screen.getByTestId("onboarding-skip-error")).toBeInTheDocument(),
    );
    expect(screen.queryByText("App shell")).not.toBeInTheDocument();
  });
});
