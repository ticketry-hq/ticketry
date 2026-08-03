import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
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
import { loadProviderCatalog, setProviderCatalog } from "./providerQueries";
import { ApiError } from "../../shared/api/client";
import type {
  ConfigurableProvider,
  ProviderCapabilities,
  ProviderCatalog,
} from "../../shared/api/types";
import * as api from "../studio/lib/api";
import {
  SETTINGS_CHECKBOX_CLASS,
  SettingsSubsection,
} from "../../shared/ui/SettingsPrimitives";
import { describeModelConfigurationChanges } from "../settings/changeLedger";

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

function outstandingChangeCount(
  saved: ProviderCatalog | null,
  draft: ProviderCatalog,
): number {
  if (!saved) return 0;
  const providerChanges = CONFIGURABLE_PROVIDERS.filter(
    (provider) =>
      saved.activated_providers.includes(provider) !==
      draft.activated_providers.includes(provider),
  ).length;
  return providerChanges +
    Number(
      (saved.global_default?.provider ?? null) !==
      (draft.global_default?.provider ?? null),
    ) +
    Number(
      (saved.global_default?.model ?? null) !==
      (draft.global_default?.model ?? null),
    ) +
    Number(
      (saved.global_default?.reasoning ?? null) !==
      (draft.global_default?.reasoning ?? null),
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

export interface ModelConfigurationCommitState {
  outstandingCount: number;
  saving: boolean;
  changes: string[];
}

export interface ModelConfigurationPanelHandle {
  discard: () => void;
  save: () => void;
}

interface ModelConfigurationPanelProps {
  onCommitStateChange?: (state: ModelConfigurationCommitState) => void;
  onChangesApplied?: (changes: string[]) => void;
  onStatusChange?: (status: {
    tone: "success" | "attention" | "danger";
    text: string;
  } | null) => void;
}

export const ModelConfigurationPanel = forwardRef<
  ModelConfigurationPanelHandle,
  ModelConfigurationPanelProps
>(function ModelConfigurationPanel({
  onCommitStateChange,
  onChangesApplied,
  onStatusChange,
}, ref) {
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
  const [attention, setAttention] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [value] = await Promise.all([
          loadProviderCatalog(),
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

  const draft = useMemo(
    () => catalogFrom(activated, launchDefault),
    [activated, launchDefault],
  );
  const outstandingCount = outstandingChangeCount(saved, draft);
  const changes = useMemo(
    () => describeModelConfigurationChanges(saved, draft),
    [draft, saved],
  );
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
  const statusText = error ?? validationError?.message ?? attention ?? notice;
  const statusTone = validationError || error
    ? "danger"
    : attention
      ? "attention"
      : "success";

  useEffect(() => {
    onStatusChange?.(
      statusText ? { tone: statusTone, text: statusText } : null,
    );
  }, [onStatusChange, statusText, statusTone]);

  const toggleProvider = (provider: ConfigurableProvider, active: boolean) => {
    setNotice(null);
    setError(null);
    if (!active && launchDefault.provider === provider) {
      setAttention(
        `Repoint the launch default before deactivating ${provider}.`,
      );
      return;
    }
    setAttention(null);
    setActivated((current) =>
      active
        ? [...current.filter((candidate) => candidate !== provider), provider]
        : current.filter((candidate) => candidate !== provider));
  };

  const updateDefault = (value: LaunchDefaultPickerValue) => {
    setNotice(null);
    setError(null);
    setAttention(null);
    setLaunchDefault(value);
  };

  const discard = () => {
    if (!saved) return;
    setActivated(saved.activated_providers);
    setLaunchDefault(pickerValueFrom(saved));
    setError(null);
    setNotice(null);
    setAttention(null);
  };

  const save = async () => {
    if (validationError) {
      setError(validationError.message);
      setNotice(null);
      setAttention(null);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    setAttention(null);
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
      setProviderCatalog(value);
      const appliedChanges = describeModelConfigurationChanges(saved, value);
      onChangesApplied?.(appliedChanges);
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

  useImperativeHandle(ref, () => ({
    discard,
    save: () => {
      void save();
    },
  }));

  useEffect(() => {
    onCommitStateChange?.({
      outstandingCount,
      saving,
      changes,
    });
  }, [changes, onCommitStateChange, outstandingCount, saving]);

  if (loading) {
    return <p className="text-sm text-text-muted">Loading model configuration…</p>;
  }

  return (
    <section aria-label="Model configuration" className="min-w-0 space-y-4">
      <SettingsSubsection
        title="Providers"
        description="Only activated providers appear in launch selectors."
      >
        <ul className="mt-2 divide-y divide-pane-border/70">
          {CONFIGURABLE_PROVIDERS.map((provider) => {
            const active = activated.includes(provider);
            return (
              <li
                key={provider}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm text-text-primary">{provider}</span>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm text-text-muted">
                  <input
                    type="checkbox"
                    aria-label={`Activate ${provider}`}
                    checked={active}
                    disabled={saving}
                    onChange={(event) =>
                      toggleProvider(provider, event.target.checked)}
                    className={SETTINGS_CHECKBOX_CLASS}
                  />
                  {active ? "On" : "Off"}
                </label>
              </li>
            );
          })}
        </ul>
      </SettingsSubsection>

      <SettingsSubsection
        title="Global launch default"
        description={
          <>
            Used wherever a launch configuration leaves provider, model, or
            reasoning unset, and for every automated launch.
          </>
        }
      >
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <LaunchDefaultPicker
            providerCapabilities={pickerCapabilities}
            value={launchDefault}
            onChange={updateDefault}
          />
        </div>
      </SettingsSubsection>

    </section>
  );
});
