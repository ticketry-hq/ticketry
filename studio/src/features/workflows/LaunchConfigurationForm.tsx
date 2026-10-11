import { useMemo } from "react";
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
import { useLaunchBindingSaveQueue } from "./internal/launchBindingSaveQueue";
import { validateLaunchBindingOptions } from "./launchBindingValidation";
import { getCodexProfilesSnapshot } from "./providerQueries";
import { StageSkillsField } from "./StageSkillsField";
import {
  canonicalSkillNames,
  useSkillAvailability,
  type SkillAvailabilityCheck,
} from "./skillAvailability";
import {
  SETTINGS_FIELD_CLASS,
  SettingsStatusLine,
} from "../../shared/ui/SettingsPrimitives";

interface LaunchConfigurationFormProps {
  binding?: ScopedWorkflowLaunchBinding;
  /** Observes whether the stage's provider can see each configured skill. */
  checkSkillAvailability?: SkillAvailabilityCheck;
  error?: string;
  issueType: IssueType;
  /** Identity of the inherited global launch default; a change rechecks. */
  launchDefaultKey?: string;
  /** The module whose linked folder supplies module-relative skill roots. */
  moduleId?: string | null;
  providerCapabilities: ProviderCapabilities[];
  promptRows?: number;
  save: (binding: LaunchBindingInput) => Promise<unknown>;
  state: State;
}

const optional = (value: string) => value.trim() || null;

export function LaunchConfigurationForm({
  binding,
  checkSkillAvailability,
  error,
  issueType,
  launchDefaultKey,
  moduleId,
  promptRows = 4,
  providerCapabilities,
  save,
  state,
}: LaunchConfigurationFormProps) {
  const identity = `${issueType.id}:${state.id}`;
  const [fields, setFields, markSaved] = useLaunchBindingFields(
    identity,
    binding,
  );
  const { prompt, stageSkills, requiredSkills, agent, profile, model, reasoning } = fields;
  const setPrompt = (next: string) => setFields({ ...fields, prompt: next });
  const skillAvailability = useSkillAvailability({
    check: checkSkillAvailability,
    moduleId,
    agent,
    profile,
    names: stageSkills,
    launchDefaultKey,
  });

  const requiredAvailability = useSkillAvailability({
    check: checkSkillAvailability,
    moduleId,
    agent,
    profile,
    names: requiredSkills,
    launchDefaultKey,
  });

  const input = useMemo<LaunchBindingInput>(() => ({
    prompt,
    stage_skills: stageSkills,
    required_skills: requiredSkills,
    agent: optional(agent),
    profile: optional(profile),
    model: optional(model),
    reasoning: optional(reasoning),
  }), [agent, model, profile, prompt, reasoning, stageSkills, requiredSkills]);
  const validationError = validateLaunchBindingOptions(input, providerCapabilities);
  const pickerValue = useMemo<LaunchDefaultPickerValue>(() => ({
    provider: agent,
    profile,
    model,
    reasoning,
  }), [agent, model, profile, reasoning]);

  const [apply, applying] = useLaunchBindingSaveQueue(identity, save, (next) => {
    markSaved({
      prompt: next.prompt ?? "",
      stageSkills: next.stage_skills ?? stageSkills,
      requiredSkills: next.required_skills ?? requiredSkills,
      agent: next.agent ?? "",
      profile: next.profile ?? "",
      model: next.model ?? "",
      reasoning: next.reasoning ?? "",
    });
  });

  const updatePicker = (next: LaunchDefaultPickerValue) => {
    setFields({
      ...fields,
      agent: next.provider,
      profile: next.profile,
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
      stage_skills: stageSkills,
      required_skills: requiredSkills,
      agent: optional(next.provider),
      profile: optional(next.profile),
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

      <StageSkillsField
        availability={checkSkillAvailability ? skillAvailability : undefined}
        skills={stageSkills}
        onChange={(edited) => {
          // An edit saves case-only matches under the installed spelling and
          // collapses names that differ only in case. A status refresh alone
          // never reaches this path, so it never writes the binding.
          const nextStageSkills = canonicalSkillNames(edited, skillAvailability.result);
          setFields({ ...fields, stageSkills: nextStageSkills });
          void apply({
            ...input,
            stage_skills: nextStageSkills,
          });
        }}
      />

      <StageSkillsField
        kind="required"
        availability={checkSkillAvailability ? requiredAvailability : undefined}
        skills={requiredSkills}
        onChange={(edited) => {
          // Disk spelling is advisory: the pinned required-skill catalog uses
          // exact identifiers, so never canonicalize these from host results.
          setFields({ ...fields, requiredSkills: edited });
          void apply({ ...input, required_skills: edited });
        }}
      />

      <LaunchDefaultPicker
        providerCapabilities={providerCapabilities}
        codexProfiles={getCodexProfilesSnapshot()}
        value={pickerValue}
        onChange={updatePicker}
        onCommit={commitPicker}
      />

      {validationError || error ? (
        <SettingsStatusLine tone="danger">
          {validationError?.message ?? error}
        </SettingsStatusLine>
      ) : null}
      {applying ? <p className="text-sm text-text-muted">Applying…</p> : null}
      <p className="text-sm text-text-muted">
        Changes apply when a field is changed or left.
      </p>
    </form>
  );
}
