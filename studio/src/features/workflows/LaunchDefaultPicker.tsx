import type { ProviderCapabilities } from "../../shared/api/types";
import { SETTINGS_FIELD_CLASS } from "../../shared/ui/SettingsPrimitives";

export interface LaunchDefaultPickerValue {
  provider: string;
  profile: string;
  model: string;
  reasoning: string;
}

interface LaunchDefaultPickerProps {
  onChange: (value: LaunchDefaultPickerValue) => void;
  onCommit?: (
    value: LaunchDefaultPickerValue,
    field: keyof LaunchDefaultPickerValue,
  ) => void;
  providerCapabilities: ProviderCapabilities[];
  codexProfiles?: string[];
  value: LaunchDefaultPickerValue;
}

export function LaunchDefaultPicker({
  onChange,
  onCommit,
  providerCapabilities,
  codexProfiles,
  value,
}: LaunchDefaultPickerProps) {
  const selectedCapability = providerCapabilities.find((candidate) =>
    candidate.agent === value.provider);
  const modelAliases = selectedCapability?.model_aliases ?? [];
  const unsupportedCurrentModel = Boolean(
    value.model && !modelAliases.includes(value.model),
  );
  const unsupportedCurrentProfile = Boolean(
    value.profile && !(codexProfiles ?? []).includes(value.profile),
  );
  const reasoningLevels = value.model
    ? selectedCapability?.model_reasoning_levels?.[value.model]
      ?? selectedCapability?.reasoning_levels
      ?? []
    : [];
  const unsupportedCurrentReasoning = Boolean(
    value.reasoning && !reasoningLevels.includes(value.reasoning),
  );

  const update = (
    field: keyof LaunchDefaultPickerValue,
    nextFieldValue: string,
    commit: boolean,
  ) => {
    // A model belongs to exactly one provider, and reasoning compatibility is
    // model-specific, so switching provider clears both dependent fields.
    const nextProvider = field === "provider"
      ? providerCapabilities.find((candidate) =>
          candidate.agent === nextFieldValue)
      : undefined;
    const nextValue = field === "provider"
      ? {
          ...value,
          provider: nextFieldValue,
          profile: "",
          model: nextProvider?.model_aliases?.[0] ?? "",
          reasoning: "",
        }
      : field === "profile"
        ? { ...value, profile: nextFieldValue, model: "", reasoning: "" }
        : field === "model" && nextFieldValue
          ? { ...value, profile: "", model: nextFieldValue }
          : { ...value, [field]: nextFieldValue };
    onChange(nextValue);
    // A provider is persisted through its model. Prefer the first catalog
    // model; if none exists, keep the local selection editable until a model
    // is entered instead of submitting an invalid provider-only binding.
    if (commit && (field !== "provider" || !nextValue.provider || nextValue.model)) {
      onCommit?.(nextValue, field);
    }
  };

  return (
    <>
      <label className="grid gap-1 text-sm text-text-muted">
        Agent/provider
        <select
          aria-label="Agent/provider"
          value={value.provider}
          onChange={(event) => update("provider", event.target.value, true)}
          className={SETTINGS_FIELD_CLASS}
        >
          <option value="">Not configured</option>
          {providerCapabilities.map((capability) => (
            <option key={capability.agent} value={capability.agent}>
              {capability.agent}
            </option>
          ))}
        </select>
      </label>

      {codexProfiles && value.provider === "codex" ? (
        <label className="grid gap-1 text-sm text-text-muted">
          Profile
          <select
            aria-label="Codex profile"
            value={value.profile}
            onChange={(event) => update("profile", event.target.value, true)}
            className={SETTINGS_FIELD_CLASS}
          >
            <option value="">No profile</option>
            {unsupportedCurrentProfile ? (
              <option value={value.profile}>{value.profile} (unregistered)</option>
            ) : null}
            {codexProfiles.map((profile) => (
              <option key={profile} value={profile}>{profile}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="grid gap-1 text-sm text-text-muted">
        Model
        <select
          aria-label="Model"
          value={value.model}
          disabled={Boolean(value.profile)}
          onChange={(event) => update("model", event.target.value, true)}
          className={SETTINGS_FIELD_CLASS}
        >
          <option value="">Provider default</option>
          {unsupportedCurrentModel ? (
            <option value={value.model}>{value.model} (unsupported)</option>
          ) : null}
          {modelAliases.map((model) => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm text-text-muted">
        Reasoning
        <select
          aria-label="Reasoning"
          value={value.reasoning}
          disabled={Boolean(value.profile)}
          onChange={(event) => update("reasoning", event.target.value, true)}
          className={SETTINGS_FIELD_CLASS}
        >
          <option value="">Provider default</option>
          {unsupportedCurrentReasoning ? (
            <option value={value.reasoning}>
              {value.reasoning} (unsupported)
            </option>
          ) : null}
          {reasoningLevels.map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </label>
    </>
  );
}
