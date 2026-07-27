import { useEffect, useMemo, useState } from "react";
import {
  LaunchDefaultPicker,
  type LaunchDefaultPickerValue,
} from "./LaunchDefaultPicker";
import {
  CONFIGURABLE_PROVIDERS,
  validateLaunchBindingOptions,
} from "./launchBindingValidation";
import { useWorkflowEditorStore } from "./workflowEditorStore";
import { ApiError } from "../../shared/api/client";
import type {
  ConfigurableProvider,
  ProviderCapabilities,
  ProviderCatalog,
} from "../../shared/api/types";
import * as api from "../studio/lib/api";

const EMPTY_DEFAULT: LaunchDefaultPickerValue = {
  provider: "",
  model: "",
  reasoning: "",
};

function pickerValueFrom(catalog: ProviderCatalog): LaunchDefaultPickerValue {
  const globalDefault = catalog.global_default;
  if (!globalDefault) return EMPTY_DEFAULT;
  return {
    provider: globalDefault.provider,
    model: globalDefault.model ?? "",
    reasoning: globalDefault.reasoning ?? "",
  };
}

function catalogFrom(
  activated: ConfigurableProvider[],
  launchDefault: LaunchDefaultPickerValue,
): ProviderCatalog {
  const provider = launchDefault.provider.trim();
  return {
    activated_providers: CONFIGURABLE_PROVIDERS.filter((candidate) =>
      activated.includes(candidate)),
    global_default: provider
      ? {
          provider: provider as ConfigurableProvider,
          model: launchDefault.model.trim() || null,
          reasoning: launchDefault.reasoning.trim() || null,
        }
      : null,
  };
}

function sameCatalog(left: ProviderCatalog, right: ProviderCatalog): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const detail = (error.body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return error instanceof Error ? error.message : String(error);
}

export function ModelConfigurationPanel() {
  const providerCapabilities = useWorkflowEditorStore(
    (state) => state.providerCapabilities,
  );
  const refreshProviderCapabilities = useWorkflowEditorStore(
    (state) => state.refreshProviderCapabilities,
  );
  const [saved, setSaved] = useState<ProviderCatalog | null>(null);
  const [activated, setActivated] = useState<ConfigurableProvider[]>([]);
  const [launchDefault, setLaunchDefault] =
    useState<LaunchDefaultPickerValue>(EMPTY_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ value }] = await Promise.all([
          api.getProviderCatalog(),
          refreshProviderCapabilities(),
        ]);
        if (cancelled) return;
        setSaved(value);
        setActivated(value.activated_providers);
        setLaunchDefault(pickerValueFrom(value));
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProviderCapabilities]);

  // The capabilities payload only carries activated providers, so a provider
  // switched on but not yet saved still needs an entry to be selectable. Its
  // real option rules arrive with the refetch after save; until then the
  // placeholder stays permissive rather than mirror-rejecting a valid model.
  const pickerCapabilities = useMemo<ProviderCapabilities[]>(
    () =>
      CONFIGURABLE_PROVIDERS.filter((provider) => activated.includes(provider))
        .map((provider) =>
          providerCapabilities.find(
            (capability) => capability.agent === provider,
          ) ?? {
            agent: provider,
            accepts_model: true,
            accepts_any_model: true,
            model_aliases: [],
            model_prefixes: [],
            reasoning_levels: [],
          }),
    [activated, providerCapabilities],
  );

  const draft = catalogFrom(activated, launchDefault);
  const dirty = saved !== null && !sameCatalog(draft, saved);
  // Same mirror validation the launch configuration form runs, so Settings and
  // the per-state form reject the same combinations before the server does.
  const validationError = validateLaunchBindingOptions(
    {
      agent: draft.global_default?.provider ?? null,
      model: draft.global_default?.model ?? null,
      reasoning: draft.global_default?.reasoning ?? null,
    },
    pickerCapabilities,
  );

  const toggleProvider = (provider: ConfigurableProvider, active: boolean) => {
    setNotice(null);
    setError(null);
    setActivated((current) =>
      active
        ? [...current.filter((candidate) => candidate !== provider), provider]
        : current.filter((candidate) => candidate !== provider));
  };

  const updateDefault = (value: LaunchDefaultPickerValue) => {
    setNotice(null);
    setError(null);
    setLaunchDefault(value);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { value } = await api.putProviderCatalog(draft);
      setSaved(value);
      setActivated(value.activated_providers);
      setLaunchDefault(pickerValueFrom(value));
      // Activation and the default drive launch selectors elsewhere in the
      // app, so the workflow editor has to see the change without a reload.
      await refreshProviderCapabilities();
      setNotice("Model configuration saved.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-text-muted">Loading model configuration…</p>;
  }

  return (
    <section aria-label="Model configuration" className="min-w-0 space-y-4">
      <div className="rounded border border-pane-border bg-pane-bg p-3">
        <h3 className="text-base font-semibold text-text-primary">Providers</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Only activated providers appear in launch selectors.
        </p>
        <ul className="mt-2 divide-y divide-pane-border/70">
          {CONFIGURABLE_PROVIDERS.map((provider) => {
            const active = activated.includes(provider);
            const locked = active && launchDefault.provider === provider;
            return (
              <li
                key={provider}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm text-text-primary">{provider}</span>
                  {locked ? (
                    <p className="text-xs text-text-muted">
                      Used by the launch default. Repoint the default before
                      deactivating {provider}.
                    </p>
                  ) : null}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    aria-label={`Activate ${provider}`}
                    checked={active}
                    disabled={locked || saving}
                    onChange={(event) =>
                      toggleProvider(provider, event.target.checked)}
                    className="h-4 w-4 accent-focus-accent disabled:opacity-40"
                  />
                  {active ? "On" : "Off"}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded border border-pane-border bg-pane-bg p-3">
        <h3 className="text-base font-semibold text-text-primary">
          Global launch default
        </h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Used wherever a launch configuration leaves provider, model, or
          reasoning unset, and for every automated launch.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <LaunchDefaultPicker
            providerCapabilities={pickerCapabilities}
            value={launchDefault}
            onChange={updateDefault}
          />
        </div>
      </div>

      {validationError || error ? (
        <div
          role="alert"
          className="rounded border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-200"
        >
          {validationError?.message ?? error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="text-sm text-emerald-300">
          {notice}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dirty || validationError !== null}
        className="rounded border border-pane-border px-3 py-1.5 text-sm text-text-primary hover:border-text-muted disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
