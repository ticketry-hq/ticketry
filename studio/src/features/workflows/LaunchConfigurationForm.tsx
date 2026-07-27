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
import { validateLaunchBindingOptions } from "./launchBindingValidation";

interface LaunchConfigurationFormProps {
  binding?: ScopedWorkflowLaunchBinding;
  error?: string;
  issueType: IssueType;
  providerCapabilities: ProviderCapabilities[];
  save: (binding: LaunchBindingInput) => Promise<unknown>;
  state: State;
}

const optional = (value: string) => value.trim() || null;

export function LaunchConfigurationForm({
  binding,
  error,
  issueType,
  providerCapabilities,
  save,
  state,
}: LaunchConfigurationFormProps) {
  const [prompt, setPrompt] = useState(binding?.prompt ?? "");
  const [agent, setAgent] = useState(binding?.agent ?? "");
  const [model, setModel] = useState(binding?.model ?? "");
  const [reasoning, setReasoning] = useState(binding?.reasoning ?? "");
  const [applying, setApplying] = useState(false);

  const input = useMemo<LaunchBindingInput>(() => ({
    prompt,
    agent: optional(agent),
    model: optional(model),
    reasoning: optional(reasoning),
  }), [agent, model, prompt, reasoning]);
  const validationError = validateLaunchBindingOptions(input, providerCapabilities);
  const pickerValue = useMemo<LaunchDefaultPickerValue>(() => ({
    provider: agent,
    model,
    reasoning,
  }), [agent, model, reasoning]);

  const apply = async (next: LaunchBindingInput) => {
    setApplying(true);
    try {
      await save(next);
    } finally {
      setApplying(false);
    }
  };

  const updatePicker = (next: LaunchDefaultPickerValue) => {
    setAgent(next.provider);
    setModel(next.model);
    setReasoning(next.reasoning);
  };
  const commitPicker = (next: LaunchDefaultPickerValue) => {
    // Built from `next`, not from the `input` memo. `updatePicker`'s setState
    // calls have not been applied yet in this same event, so merging a patch
    // into `input` would carry the *previous* render's values — writing the
    // old reasoning alongside the new provider, a pair the server 422s.
    void apply({
      prompt,
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
      <label className="grid gap-1 text-xs text-text-muted">
        Prompt
        <textarea
          aria-label="Prompt"
          value={prompt}
          rows={4}
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={() => void apply(input)}
          className="resize-y rounded border border-pane-border bg-pane-panel px-2 py-2 text-sm text-text-primary"
          placeholder="No prompt configured"
        />
      </label>

      <LaunchDefaultPicker
        providerCapabilities={providerCapabilities}
        value={pickerValue}
        onChange={updatePicker}
        onCommit={commitPicker}
      />

      {validationError || error ? (
        <div role="alert" className="rounded border border-red-500/50 bg-red-950/30 p-2 text-xs text-red-200">
          {validationError?.message ?? error}
        </div>
      ) : null}
      {applying ? <p className="text-xs text-text-muted">Applying…</p> : null}
      <p className="text-[11px] text-text-muted">
        Changes apply when a field is changed or left.
      </p>
    </form>
  );
}
