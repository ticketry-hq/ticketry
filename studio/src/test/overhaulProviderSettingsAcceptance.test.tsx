import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const providerApi = vi.hoisted(() => ({
  loadProviderCapabilities: vi.fn(),
  loadConfigurableProviderCapabilities: vi.fn(),
  loadProviderCatalog: vi.fn(),
  updateProviderCatalog: vi.fn(),
  setProviderCapabilities: vi.fn(),
  catalog: {
    activated_providers: ["claude", "codex", "gemini"],
    codex_profiles: [] as string[],
    global_default: null as null | {
      provider: "claude" | "codex" | "gemini";
      profile: string | null;
      model: string | null;
      reasoning: string | null;
    },
  },
  capabilities: [] as unknown[],
  catalogPending: false,
  catalogError: null as Error | null,
  capabilitiesPending: false,
  capabilitiesError: null as Error | null,
}));

vi.mock("../features/workflows/providerQueries", () => ({
  ...providerApi,
  useProviderCatalogQuery: () => ({
    data: providerApi.catalog,
    isPending: providerApi.catalogPending,
    error: providerApi.catalogError,
  }),
  useConfigurableProviderCapabilitiesQuery: () => ({
    data: providerApi.capabilities,
    isPending: providerApi.capabilitiesPending,
    error: providerApi.capabilitiesError,
  }),
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
    providerApi.catalog = {
      activated_providers: ["claude", "codex", "gemini"],
      codex_profiles: [],
      global_default: null,
    };
    providerApi.catalogPending = false;
    providerApi.catalogError = null;
    providerApi.capabilitiesPending = false;
    providerApi.capabilitiesError = null;
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

  it("[overhaul-362] allows planning without a provider and persists the empty catalog", async () => {
    providerApi.catalog = {
      activated_providers: [],
      codex_profiles: ["reviewer", "fast-fix"],
      global_default: null,
    };
    const onContinue = vi.fn();

    render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText(
      "You can plan work without an agent subscription. Select the providers you use, or leave them unchecked and configure them later in Settings > Model configuration.",
    )).toBeVisible();

    const getStarted = screen.getByRole("button", { name: "Get started" });
    expect(getStarted).toBeEnabled();
    fireEvent.click(getStarted);

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(providerApi.updateProviderCatalog).toHaveBeenCalledWith({
      activated_providers: [],
      codex_profiles: ["reviewer", "fast-fix"],
      global_default: null,
    });
  });

  it("clears the automatic default when the last provider is deselected", async () => {
    providerApi.catalog = {
      activated_providers: [],
      codex_profiles: [],
      global_default: null,
    };
    const onContinue = vi.fn();

    render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    const codex = screen.getByRole("checkbox", { name: "I use codex" });
    fireEvent.click(codex);
    expect(codex).toBeChecked();
    fireEvent.click(codex);
    expect(codex).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(providerApi.updateProviderCatalog).toHaveBeenCalledWith({
      activated_providers: [],
      codex_profiles: [],
      global_default: null,
    });
  });

  it("does not treat an unreadable or pending catalog as a saved empty choice", async () => {
    const onContinue = vi.fn();
    providerApi.catalogPending = true;
    const view = render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText("Loading providers…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Get started" })).toBeDisabled();

    providerApi.catalogPending = false;
    providerApi.catalogError = new Error("Provider catalog is unavailable.");
    view.rerender(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider catalog is unavailable.",
    );
    expect(screen.getByRole("button", { name: "Get started" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(providerApi.updateProviderCatalog).not.toHaveBeenCalled();

    providerApi.catalogError = null;
    view.rerender(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get started" })).toBeEnabled();
  });

  it("hydrates the authoritative catalog after a stale cached read recovers", async () => {
    providerApi.catalog = {
      activated_providers: [],
      codex_profiles: ["stale-profile"],
      global_default: null,
    };
    providerApi.catalogPending = true;
    providerApi.catalogError = new Error("Provider catalog is unavailable.");
    const onContinue = vi.fn();
    const view = render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText("Loading providers…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Get started" })).toBeDisabled();

    providerApi.catalog = {
      activated_providers: ["codex"],
      codex_profiles: ["authoritative-profile"],
      global_default: {
        provider: "codex",
        profile: null,
        model: null,
        reasoning: null,
      },
    };
    providerApi.catalogPending = false;
    providerApi.catalogError = null;
    view.rerender(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "I use codex" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(providerApi.updateProviderCatalog).toHaveBeenCalledWith({
      activated_providers: ["codex"],
      codex_profiles: ["authoritative-profile"],
      global_default: {
        provider: "codex",
        profile: null,
        model: null,
        reasoning: null,
      },
    });
  });

  it("keeps the selection and retries after a failed save without continuing twice", async () => {
    providerApi.catalog = {
      activated_providers: [],
      codex_profiles: [],
      global_default: null,
    };
    let rejectSave: (cause: Error) => void = () => {};
    providerApi.updateProviderCatalog
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectSave = reject;
      }))
      .mockImplementationOnce(async (value) => value);
    const onContinue = vi.fn();

    render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    const codex = screen.getByRole("checkbox", { name: "I use codex" });
    fireEvent.click(codex);
    const getStarted = screen.getByRole("button", { name: "Get started" });
    fireEvent.click(getStarted);
    fireEvent.click(getStarted);

    expect(providerApi.updateProviderCatalog).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(onContinue).not.toHaveBeenCalled();

    rejectSave(new Error("Catalog save failed."));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Catalog save failed.",
    );
    expect(codex).toBeChecked();
    expect(onContinue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(providerApi.updateProviderCatalog).toHaveBeenCalledTimes(2);
  });

  it("keeps the selected provider as the automatic single-provider default", async () => {
    providerApi.catalog = {
      activated_providers: [],
      codex_profiles: [],
      global_default: null,
    };
    const onContinue = vi.fn();

    render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(providerApi.updateProviderCatalog).toHaveBeenCalledWith({
      activated_providers: ["codex"],
      codex_profiles: [],
      global_default: {
        provider: "codex",
        profile: null,
        model: null,
        reasoning: null,
      },
    });
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
        codex_profiles: [],
        global_default: {
          provider: "codex",
          profile: null,
          model: "gpt-5.6-luna",
          reasoning: "medium",
        },
    });
    expect(screen.getByRole("heading", { name: "Your agents" })).toBeVisible();
  });
});
