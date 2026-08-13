import { useId } from "react";
import type { ProviderCapabilities } from "../../shared/api/types";
import { SETTINGS_FIELD_CLASS } from "../../shared/ui/SettingsPrimitives";

export interface LaunchDefaultPickerValue {
  provider: string;
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
  value: LaunchDefaultPickerValue;
}

export function LaunchDefaultPicker({
  onChange,
  onCommit,
  providerCapabilities,
  value,
}: LaunchDefaultPickerProps) {
  const modelSuggestionsId = useId();
  const selectedCapability = providerCapabilities.find((candidate) =>
    candidate.agent === value.provider);
  const modelAliases = selectedCapability?.model_aliases ?? [];
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
    const nextValue = field === "provider"
      ? {
          ...value,
          provider: nextFieldValue,
          model: "",
          reasoning: "",
        }
      : { ...value, [field]: nextFieldValue };
    onChange(nextValue);
    if (commit) {
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

      <label className="grid gap-1 text-sm text-text-muted">
        Model
        <input
          aria-label="Model"
          value={value.model}
          onChange={(event) => update("model", event.target.value, false)}
          onBlur={() => onCommit?.(value, "model")}
          className={SETTINGS_FIELD_CLASS}
          placeholder="Provider default"
          list={modelSuggestionsId}
        />
        <datalist id={modelSuggestionsId}>
          {modelAliases.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>

      <label className="grid gap-1 text-sm text-text-muted">
        Reasoning
        <select
          aria-label="Reasoning"
          value={value.reasoning}
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
