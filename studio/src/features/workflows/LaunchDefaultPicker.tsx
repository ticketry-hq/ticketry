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

const REASONING_LEVEL_ORDER = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

const reasoningLevelRank = new Map<string, number>(
  REASONING_LEVEL_ORDER.map((level, index) => [level, index]),
);

function sortReasoningLevels(levels: readonly string[]): string[] {
  return levels.map((level, index) => ({ level, index })).sort((left, right) => {
    const leftRank = reasoningLevelRank.get(left.level);
    const rightRank = reasoningLevelRank.get(right.level);
    if (leftRank === undefined && rightRank === undefined) {
      return left.index - right.index;
    }
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  }).map(({ level }) => level);
}

export function LaunchDefaultPicker({
  onChange,
  onCommit,
  providerCapabilities,
  value,
}: LaunchDefaultPickerProps) {
  const selectedCapability = providerCapabilities.find((candidate) =>
    candidate.agent === value.provider);
  const models = selectedCapability?.models ?? [];
  const selectedModel = models.find((model) => model.name === value.model);
  const reasoningLevels = sortReasoningLevels(
    selectedModel?.reasoning_levels ?? [],
  );
  const unsupportedCurrentModel = Boolean(
    value.model && !selectedModel,
  );
  const unsupportedCurrentReasoning = Boolean(
    value.reasoning && !reasoningLevels.includes(value.reasoning),
  );

  const reasoningLevelsFor = (provider: string, model: string) =>
    providerCapabilities.find((candidate) => candidate.agent === provider)
      ?.models.find((candidate) => candidate.name === model)
      ?.reasoning_levels ?? [];

  const update = (
    field: keyof LaunchDefaultPickerValue,
    nextFieldValue: string,
    commit: boolean,
  ) => {
    // Model rows belong to providers, and reasoning rows are permitted by one
    // selected model. A user-driven parent change normalizes only the dependent
    // values it can verify; stored unsupported values remain visible otherwise.
    const nextValue = field === "provider"
      ? {
          ...value,
          provider: nextFieldValue,
          model: "",
          reasoning: "",
        }
      : field === "model"
        ? {
            ...value,
            model: nextFieldValue,
            reasoning: reasoningLevelsFor(value.provider, nextFieldValue)
              .includes(value.reasoning) ? value.reasoning : "",
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
        <select
          aria-label="Model"
          value={value.model}
          onChange={(event) => update("model", event.target.value, true)}
          className={SETTINGS_FIELD_CLASS}
        >
          <option value="">Provider default</option>
          {unsupportedCurrentModel ? (
            <option value={value.model}>{value.model} (unsupported)</option>
          ) : null}
          {models.map((model) => (
            <option key={model.name} value={model.name}>{model.name}</option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm text-text-muted">
        Reasoning
        <select
          aria-label="Reasoning"
          value={value.reasoning}
          onChange={(event) => update("reasoning", event.target.value, true)}
          className={SETTINGS_FIELD_CLASS}
        >
          <option value="">Model default</option>
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
