import { useEffect, useMemo, useState } from "react";
import { apiErrorMessage } from "../../shared/api/client";
import type {
  ConfigurableProvider,
  ProviderCapabilities,
  ProviderCatalog,
} from "../../shared/api/types";
import * as api from "../../features/studio/lib/api";
import {
  LaunchDefaultPicker,
  type LaunchDefaultPickerValue,
} from "../../features/workflows/LaunchDefaultPicker";
import {
  CONFIGURABLE_PROVIDERS,
  validateLaunchBindingOptions,
} from "../../features/workflows/launchBindingValidation";
import {
  setProviderCatalog,
  setProviderCapabilities,
  useProviderCapabilitiesQuery,
  useProviderCatalogQuery,
} from "../../features/workflows/providerQueries";

const EMPTY_DEFAULT: LaunchDefaultPickerValue = {
  provider: "",
  model: "",
  reasoning: "",
};

function pickerValueFrom(catalog: ProviderCatalog): LaunchDefaultPickerValue {
  const launchDefault = catalog.global_default;
  return launchDefault
    ? {
        provider: launchDefault.provider,
        model: launchDefault.model ?? "",
        reasoning: launchDefault.reasoning ?? "",
      }
    : EMPTY_DEFAULT;
}

function permissiveCapability(provider: ConfigurableProvider): ProviderCapabilities {
  return {
    agent: provider,
    accepts_model: true,
    accepts_any_model: true,
    model_aliases: [],
    model_prefixes: [],
    reasoning_levels: [],
  };
}

interface Props {
  onContinue: () => void;
}

export function OnboardingProviders({ onContinue }: Props) {
  const [activated, setActivated] = useState<ConfigurableProvider[]>([]);
  const [launchDefault, setLaunchDefault] =
    useState<LaunchDefaultPickerValue>(EMPTY_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catalogQuery = useProviderCatalogQuery();
  const capabilitiesQuery = useProviderCapabilitiesQuery();
  const capabilities = capabilitiesQuery.data ?? [];
  const loading = catalogQuery.isPending || capabilitiesQuery.isPending;

  useEffect(() => {
    const value = catalogQuery.data;
    if (value) {
        // An absent backend setting intentionally reads as all providers active
        // with no default for pre-onboarding compatibility. On a pending first
        // run that is not a declaration: only a catalog completed by this pane
        // (and therefore carrying a default) is restored after a reload.
        if (value.global_default) {
          setActivated(value.activated_providers);
          setLaunchDefault(pickerValueFrom(value));
        } else {
          setActivated([]);
          setLaunchDefault(EMPTY_DEFAULT);
        }
    }
  }, [catalogQuery.data]);

  useEffect(() => {
    const cause = catalogQuery.error ?? capabilitiesQuery.error;
    if (cause) setError(apiErrorMessage(cause));
  }, [capabilitiesQuery.error, catalogQuery.error]);

  const pickerCapabilities = useMemo(
    () =>
      CONFIGURABLE_PROVIDERS.filter((provider) =>
        activated.includes(provider),
      ).map(
        (provider) =>
          capabilities.find((candidate) => candidate.agent === provider)
          ?? permissiveCapability(provider),
      ),
    [activated, capabilities],
  );

  const draft: ProviderCatalog = {
    activated_providers: CONFIGURABLE_PROVIDERS.filter((provider) =>
      activated.includes(provider),
    ),
    global_default: launchDefault.provider
      ? {
          provider: launchDefault.provider as ConfigurableProvider,
          model: launchDefault.model.trim() || null,
          reasoning: launchDefault.reasoning.trim() || null,
        }
      : null,
  };
  const validationError = validateLaunchBindingOptions(
    {
      agent: draft.global_default?.provider ?? null,
      model: draft.global_default?.model ?? null,
      reasoning: draft.global_default?.reasoning ?? null,
    },
    pickerCapabilities,
  );
  const needsExplicitDefault =
    activated.length >= 2 && !draft.global_default;
  const canContinue =
    !loading
    && !saving
    && activated.length > 0
    && !needsExplicitDefault
    && validationError === null;

  const toggleProvider = (
    provider: ConfigurableProvider,
    checked: boolean,
  ) => {
    setError(null);
    const next = CONFIGURABLE_PROVIDERS.filter((candidate) =>
      checked
        ? activated.includes(candidate) || candidate === provider
        : activated.includes(candidate) && candidate !== provider,
    );
    setActivated(next);
    if (next.length === 1) {
      const only = next[0];
      setLaunchDefault((current) =>
        current.provider === only
          ? current
          : { ...EMPTY_DEFAULT, provider: only },
      );
    } else if (
      (activated.length < 2 && next.length >= 2)
      || (launchDefault.provider
        && !next.includes(launchDefault.provider as ConfigurableProvider))
    ) {
      setLaunchDefault(EMPTY_DEFAULT);
    }
  };

  const continueOnboarding = async () => {
    if (!canContinue) return;
    setSaving(true);
    setError(null);
    try {
      const { value } = await api.putProviderCatalog(draft);
      setProviderCatalog(value);
      setProviderCapabilities(
        capabilities.filter((capability) =>
          value.activated_providers.includes(
            capability.agent as ConfigurableProvider,
          ),
        ),
      );
      onContinue();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setSaving(false);
    }
  };

  return (
    <>
      <h1 className="mt-3 text-2xl font-semibold text-text-primary">
        Your agents
      </h1>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        Which coding-agent subscriptions do you hold? We’ll only offer agents
        you can run.
      </p>

      {loading ? (
        <p className="mt-7 text-sm text-text-muted">Loading providers…</p>
      ) : (
        <div className="mt-7 space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Agent subscriptions
            </legend>
            {CONFIGURABLE_PROVIDERS.map((provider) => (
              <label
                key={provider}
                className="flex items-center justify-between rounded-md border border-pane-border bg-pane-bg px-3 py-2 text-sm text-text-primary"
              >
                <span>{provider}</span>
                <input
                  type="checkbox"
                  aria-label={`I use ${provider}`}
                  checked={activated.includes(provider)}
                  disabled={saving}
                  onChange={(event) =>
                    toggleProvider(provider, event.target.checked)}
                  className="h-4 w-4 accent-focus-accent"
                />
              </label>
            ))}
          </fieldset>

          {activated.length >= 2 ? (
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Launch default
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                Choose the provider, model, and reasoning used for launches
                without their own configuration.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <LaunchDefaultPicker
                  providerCapabilities={pickerCapabilities}
                  value={launchDefault}
                  onChange={(value) => {
                    setError(null);
                    setLaunchDefault(value);
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {validationError || error ? (
        <p
          role="alert"
          className="mt-4 text-sm text-lifecycle-danger"
        >
          {validationError?.message ?? error}
        </p>
      ) : null}

      <div className="mt-7 flex justify-end">
        <button
          type="button"
          onClick={() => void continueOnboarding()}
          disabled={!canContinue}
          className="rounded-md bg-focus-accent px-4 py-2 text-sm font-semibold text-pane-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </>
  );
}
