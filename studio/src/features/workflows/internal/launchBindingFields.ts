import { useState } from "react";
import type { ScopedWorkflowLaunchBinding } from "../../../shared/api/types";

/** The editable fields of one state's launch configuration. */
export interface LaunchBindingFields {
  prompt: string;
  agent: string;
  model: string;
  reasoning: string;
}

/** The stored binding rendered as form fields; an absent binding is empty. */
export function storedLaunchBindingFields(
  binding?: ScopedWorkflowLaunchBinding,
): LaunchBindingFields {
  return {
    prompt: binding?.prompt ?? "",
    agent: binding?.agent ?? "",
    model: binding?.model ?? "",
    reasoning: binding?.reasoning ?? "",
  };
}

/**
 * Form fields that follow the stored binding instead of freezing whatever was
 * loaded at mount.
 *
 * The launch configuration form is rendered once and reused across issue types,
 * states, and the workflow's own hydration, so seeding `useState` from props was
 * a defect and not a shortcut: a form mounted before the workflow loaded, or
 * left over from another state, kept an empty prompt while showing a configured
 * binding. Saving from that form — a provider or model change is enough — wrote
 * the empty prompt over the stored one, and `LaunchPolicyResolver` then refused
 * every launch for that type and state with `prompt_not_configured`
 * (ticket #1372).
 *
 * Fields resynchronise when the edited binding's identity changes and when the
 * first stored binding arrives. They deliberately do not resynchronise on later
 * value changes, so a save round-trip never overwrites text still being typed.
 */
export function useLaunchBindingFields(
  identity: string,
  binding?: ScopedWorkflowLaunchBinding,
): readonly [LaunchBindingFields, (next: LaunchBindingFields) => void] {
  const stored = storedLaunchBindingFields(binding);
  const [fields, setFields] = useState(stored);
  const [source, setSource] = useState(() => ({
    identity,
    hydrated: binding !== undefined,
  }));

  if (source.identity !== identity || (!source.hydrated && binding !== undefined)) {
    setSource({ identity, hydrated: binding !== undefined });
    setFields(stored);
    return [stored, setFields] as const;
  }
  return [fields, setFields] as const;
}
