import { useMemo, useState } from "react";
import type {
  IssueType,
  LaunchBindingInput,
  ProviderCapabilities,
  ScopedWorkflowLaunchBinding,
  State,
} from "../../shared/api/types";
import {
  LaunchDefaultPicker,
  type LaunchDefaultPickerValue,
} from "./LaunchDefaultPicker";
import { useLaunchBindingFields } from "./internal/launchBindingFields";
import {
  entrySkillWarning,
  validateLaunchBindingOptions,
} from "./launchBindingValidation";
import {
  SETTINGS_FIELD_CLASS,
  SettingsStatusLine,
} from "../../shared/ui/SettingsPrimitives";

interface LaunchConfigurationFormProps {
  binding?: ScopedWorkflowLaunchBinding;
  error?: string;
  issueType: IssueType;
  providerCapabilities: ProviderCapabilities[];
  promptRows?: number;
  save: (binding: LaunchBindingInput) => Promise<unknown>;
  state: State;
}

const optional = (value: string) => value.trim() || null;

export function LaunchConfigurationForm({
  binding,
  error,
  issueType,
  promptRows = 4,
  providerCapabilities,
  save,
  state,
}: LaunchConfigurationFormProps) {
  const [fields, setFields, markSaved] = useLaunchBindingFields(
    `${issueType.id}:${state.id}`,
    binding,
  );
  const { prompt, entrySkill, agent, model, reasoning } = fields;
  const setPrompt = (next: string) => setFields({ ...fields, prompt: next });
  const [applying, setApplying] = useState(false);

  const input = useMemo<LaunchBindingInput>(() => ({
    prompt,
    entry_skill: optional(entrySkill),
    agent: optional(agent),
    model: optional(model),
    reasoning: optional(reasoning),
  }), [agent, entrySkill, model, prompt, reasoning]);
  const validationError = validateLaunchBindingOptions(input, providerCapabilities);
  const skillWarning = entrySkillWarning(
    binding?.required_skills ?? [],
    entrySkill,
  );
  const pickerValue = useMemo<LaunchDefaultPickerValue>(() => ({
    provider: agent,
    model,
    reasoning,
  }), [agent, model, reasoning]);

  const apply = async (next: LaunchBindingInput) => {
    setApplying(true);
    try {
      await save(next);
      markSaved({
        prompt: next.prompt ?? "",
        entrySkill: next.entry_skill ?? "",
        agent: next.agent ?? "",
        model: next.model ?? "",
        reasoning: next.reasoning ?? "",
      });
    } finally {
      setApplying(false);
    }
  };

  const updatePicker = (next: LaunchDefaultPickerValue) => {
    setFields({
      ...fields,
      agent: next.provider,
      model: next.model,
      reasoning: next.reasoning,
    });
  };
  const commitPicker = (next: LaunchDefaultPickerValue) => {
    // Built from `next`, not from the `input` memo. `updatePicker`'s setState
    // calls have not been applied yet in this same event, so merging a patch
    // into `input` would carry the *previous* render's values — writing the
    // old reasoning alongside the new provider, a pair the server 422s.
    void apply({
      prompt,
      entry_skill: optional(entrySkill),
      agent: optional(next.provider),
      model: optional(next.model),
      reasoning: optional(next.reasoning),
    });
  };

  return (
    <form
      aria-label={`${issueType.name} · ${state.name} launch configuration`}
      className="mt-3 space-y-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="grid gap-1 text-sm text-text-muted">
        Prompt
        <textarea
          aria-label="Prompt"
          value={prompt}
          rows={promptRows}
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={() => void apply(input)}
          className={`${SETTINGS_FIELD_CLASS} w-full resize-y`}
          placeholder="No prompt configured"
        />
      </label>

      <label className="grid gap-1 text-sm text-text-muted">
        Entry skill
        <select
          aria-label="Entry skill"
          value={entrySkill}
          onChange={(event) => {
            const nextEntrySkill = event.target.value;
            setFields({ ...fields, entrySkill: nextEntrySkill });
            void apply({
              ...input,
              entry_skill: optional(nextEntrySkill),
            });
          }}
          className={SETTINGS_FIELD_CLASS}
        >
          <option value="">No entry skill</option>
          {(binding?.required_skills ?? []).map((skill) => (
            <option key={skill} value={skill}>{skill}</option>
          ))}
        </select>
      </label>

      <LaunchDefaultPicker
        providerCapabilities={providerCapabilities}
        value={pickerValue}
        onChange={updatePicker}
        onCommit={commitPicker}
      />

      {validationError || error ? (
        <SettingsStatusLine tone="danger">
          {validationError?.message ?? error}
        </SettingsStatusLine>
      ) : null}
      {skillWarning ? (
        <SettingsStatusLine tone="attention">{skillWarning}</SettingsStatusLine>
      ) : null}
      {applying ? <p className="text-sm text-text-muted">Applying…</p> : null}
      <p className="text-sm text-text-muted">
        Changes apply when a field is changed or left.
      </p>
    </form>
  );
}
