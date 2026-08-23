import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const providerApi = vi.hoisted(() => ({
  loadProviderCapabilities: vi.fn(),
  loadConfigurableProviderCapabilities: vi.fn(),
  loadProviderCatalog: vi.fn(),
  updateProviderCatalog: vi.fn(),
  setProviderCapabilities: vi.fn(),
  catalog: { activated_providers: ["claude", "codex", "gemini"], global_default: null },
  capabilities: [] as unknown[],
}));

vi.mock("../features/workflows/providerQueries", () => ({
  ...providerApi,
  useProviderCatalogQuery: () => ({ data: providerApi.catalog, isLoading: false, isError: false }),
  useConfigurableProviderCapabilitiesQuery: () => ({ data: providerApi.capabilities, isLoading: false, isError: false }),
}));

import { OnboardingProviders } from "../app/onboarding/OnboardingProviders";

const providers = [
  {
    id: "provider-claude",
    slug: "claude",
    activated: true,
    supports_unattended: true,
  },
  {
    id: "provider-codex",
    slug: "codex",
    activated: true,
    supports_unattended: true,
  },
  {
    id: "provider-gemini",
    slug: "gemini",
    activated: true,
    supports_unattended: true,
  },
];

describe("provider settings acceptance", () => {
  beforeEach(() => {
    providerApi.capabilities = [
      { agent: "claude", accepts_model: true, accepts_any_model: false, model_aliases: [], model_prefixes: [], reasoning_levels: [] },
      { agent: "codex", accepts_model: true, accepts_any_model: false, model_aliases: ["gpt-5.6-luna"], model_prefixes: [], reasoning_levels: ["medium"], model_reasoning_levels: { "gpt-5.6-luna": ["medium"] } },
      { agent: "gemini", accepts_model: true, accepts_any_model: false, model_aliases: [], model_prefixes: [], reasoning_levels: [] },
    ];
    providerApi.loadConfigurableProviderCapabilities.mockReset().mockResolvedValue(providerApi.capabilities);
    providerApi.loadProviderCapabilities.mockReset().mockResolvedValue([]);
    providerApi.loadProviderCatalog.mockReset().mockResolvedValue({
      activated_providers: providers.map(({ slug }) => slug),
      global_default: null,
    });
    providerApi.updateProviderCatalog.mockReset().mockImplementation(async (value) => value);
  });

  it("[overhaul-17] saves a Luna default during fresh provider onboarding", async () => {
    const onContinue = vi.fn();
    render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I use claude" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "codex" },
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "gpt-5.6-luna" },
    });

    const reasoning = screen.getByRole("combobox", { name: "Reasoning" });
    await waitFor(() => {
      expect(
        within(reasoning).getByRole("option", { name: "medium" }),
      ).toBeInTheDocument();
    });
    fireEvent.change(reasoning, { target: { value: "medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(providerApi.updateProviderCatalog).toHaveBeenCalledWith({
        activated_providers: ["claude", "codex"],
        global_default: {
          provider: "codex",
          model: "gpt-5.6-luna",
          reasoning: "medium",
        },
    });
    expect(screen.getByRole("heading", { name: "Your agents" })).toBeVisible();
  });
});
