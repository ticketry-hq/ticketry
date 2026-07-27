import { useId } from "react";
import type { ProviderCapabilities } from "../../shared/api/types";

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
  const reasoningLevels = selectedCapability?.reasoning_levels ?? [];
  const unsupportedCurrentReasoning = Boolean(
    value.reasoning && !reasoningLevels.includes(value.reasoning),
  );

  const reasoningLevelsFor = (provider: string) =>
    providerCapabilities.find((candidate) => candidate.agent === provider)
      ?.reasoning_levels ?? [];

  const update = (
    field: keyof LaunchDefaultPickerValue,
    nextFieldValue: string,
    commit: boolean,
  ) => {
    // A model belongs to exactly one provider, so switching provider clears it
    // rather than carrying a name the new CLI would reject. Reasoning names do
    // overlap, so one the new provider also offers is carried across — but one
    // it does not is dropped rather than written back as an invalid pair. The
    // `(unsupported)` option below still shows a level that arrived from the
    // server; this only refuses to carry one forward across a user's change.
    const nextValue = field === "provider"
      ? {
          ...value,
          provider: nextFieldValue,
          model: "",
          reasoning: reasoningLevelsFor(nextFieldValue).includes(value.reasoning)
            ? value.reasoning
            : "",
        }
      : { ...value, [field]: nextFieldValue };
    onChange(nextValue);
    if (commit) {
      onCommit?.(nextValue, field);
    }
  };

  return (
    <>
      <label className="grid gap-1 text-xs text-text-muted">
        Agent/provider
        <select
          aria-label="Agent/provider"
          value={value.provider}
          onChange={(event) => update("provider", event.target.value, true)}
          className="rounded border border-pane-border bg-pane-panel px-2 py-2 text-sm text-text-primary"
        >
          <option value="">Not configured</option>
          {providerCapabilities.map((capability) => (
            <option key={capability.agent} value={capability.agent}>
              {capability.agent}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-xs text-text-muted">
        Model
        <input
          aria-label="Model"
          value={value.model}
          onChange={(event) => update("model", event.target.value, false)}
          onBlur={() => onCommit?.(value, "model")}
          className="rounded border border-pane-border bg-pane-panel px-2 py-2 text-sm text-text-primary"
          placeholder="Provider default"
          list={modelSuggestionsId}
        />
        <datalist id={modelSuggestionsId}>
          {modelAliases.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>

      <label className="grid gap-1 text-xs text-text-muted">
        Reasoning
        <select
          aria-label="Reasoning"
          value={value.reasoning}
          onChange={(event) => update("reasoning", event.target.value, true)}
          className="rounded border border-pane-border bg-pane-panel px-2 py-2 text-sm text-text-primary"
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
