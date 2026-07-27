import { useEffect, useMemo, useState } from "react";
import {
  LaunchDefaultPicker,
  type LaunchDefaultPickerValue,
} from "./LaunchDefaultPicker";
import {
  CONFIGURABLE_PROVIDERS,
  PROVIDER_CAPABILITY_DEFAULTS,
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

// Compared structurally rather than by JSON string: the string form depends on
// CONFIGURABLE_PROVIDERS matching the server's PROVIDER_ORDER serialization and
// on object key order, so a reorder on either side would make a freshly loaded
// panel read as dirty.
function sameCatalog(left: ProviderCatalog, right: ProviderCatalog): boolean {
  const activation = (catalog: ProviderCatalog) =>
    [...catalog.activated_providers].sort().join(",");
  const launchDefault = (catalog: ProviderCatalog) =>
    catalog.global_default
      ? [
          catalog.global_default.provider,
          catalog.global_default.model ?? "",
          catalog.global_default.reasoning ?? "",
        ].join("\u0000")
      : null;
  return (
    activation(left) === activation(right) &&
    launchDefault(left) === launchDefault(right)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const detail = (error.body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
    // A pydantic/Ninja 422 arrives as a list of per-field objects. Reading only
    // the string form replaced the server's actual message ("reasoning is not
    // valid for provider 'gemini'") with a bare "HTTP 422".
    if (Array.isArray(detail)) {
      const messages = detail
        .map((entry) =>
          entry && typeof entry === "object"
            ? String((entry as { msg?: unknown }).msg ?? "")
            : String(entry))
        .filter(Boolean);
      if (messages.length > 0) return messages.join("; ");
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function blockedBindingsSummary(blocked: number): string {
  return blocked === 1
    ? "1 launch configuration names a deactivated provider and is blocked "
      + "until it is repointed."
    : `${blocked} launch configurations name a deactivated provider and are `
      + "blocked until they are repointed.";
}

function blockedBindingsPrompt(blocked: number): string {
  return `${blockedBindingsSummary(blocked)}\n\nSave anyway?`;
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
  // switched on but not yet saved still needs an entry to be selectable. The
  // placeholder comes from the client-side mirror of the server's catalog, so
  // its models and reasoning levels are offered immediately instead of only
  // after a save round-trip. The authoritative payload wins once it arrives.
  const pickerCapabilities = useMemo<ProviderCapabilities[]>(
    () =>
      CONFIGURABLE_PROVIDERS.filter((provider) => activated.includes(provider))
        .map((provider) =>
          providerCapabilities.find(
            (capability) => capability.agent === provider,
          ) ?? PROVIDER_CAPABILITY_DEFAULTS[provider]),
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
      // Every other workflow mutation previews its blast radius first. A
      // deactivation silently invalidated every binding naming that provider,
      // discovered one failed launch at a time — so ask before committing.
      const { blocked_launch_bindings: blocked } =
        await api.previewProviderCatalogImpact(draft);
      if (blocked > 0 && !window.confirm(blockedBindingsPrompt(blocked))) {
        return;
      }
      const { value } = await api.putProviderCatalog(draft);
      setSaved(value);
      setActivated(value.activated_providers);
      setLaunchDefault(pickerValueFrom(value));
      // Activation and the default drive launch selectors elsewhere in the
      // app, so the workflow editor has to see the change without a reload.
      await refreshProviderCapabilities();
      setNotice(
        blocked > 0
          ? `Model configuration saved. ${blockedBindingsSummary(blocked)}`
          : "Model configuration saved.",
      );
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

      {/* Rendered separately: routing both through one box with validation
          winning made a failed save invisible while any mirror error stood. */}
      {validationError ? (
        <div
          role="alert"
          className="rounded border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-200"
        >
          {validationError.message}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-200"
        >
          {error}
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
