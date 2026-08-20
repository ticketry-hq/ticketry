import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...catalogApi,
}));

import { OnboardingGate } from "../app/onboarding/OnboardingGate";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";

beforeEach(() => {
  catalogApi.getLaunchProviderCapabilities.mockReset().mockResolvedValue([]);
  catalogApi.getProviderCatalog.mockReset().mockResolvedValue({
    value: { activated_providers: [], global_default: null },
  });
  catalogApi.putProviderCatalog.mockReset().mockImplementation(async (value) => ({
    value,
  }));
  queryClient.setQueryData(queryKeys.onboarding, false);
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
    queryClient.setQueryData(queryKeys.onboarding, true);

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    expect(screen.queryByText("App shell")).not.toBeInTheDocument();
  });

  it("hands off to the app shell while the guided tour is active", () => {
    queryClient.setQueryData(queryKeys.onboarding, true);
    useOnboardingTourStore.getState().start("created-project");

    render(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(screen.getByText("App shell")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.onboarding)).toBe(true);
  });

  it("does not offer a way to skip required onboarding", () => {
    queryClient.setQueryData(queryKeys.onboarding, true);

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
  });
});
