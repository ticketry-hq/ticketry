import type {
  ConfigurableProvider,
  LaunchBinding,
  LaunchBindingInput,
  ProviderCapabilities,
} from "../../shared/api/types";

// The `agy` adapter stays in code but is deliberately not configurable in
// Settings (ADR-0015); only the three built-in providers are.
export const CONFIGURABLE_PROVIDERS: readonly ConfigurableProvider[] = [
  "claude",
  "codex",
  "gemini",
];

export interface LaunchBindingValidationError {
  field: "agent" | "model" | "reasoning";
  message: string;
}

/**
 * Why a provider is missing from the capabilities payload. A built-in the host
 * deactivated is blocked, not unsupported — the launch is refused with
 * `provider_not_activated` until the binding is repointed or the provider is
 * switched back on, and the message has to say so rather than read as a typo.
 */
export function unavailableProviderMessage(agent: string): string {
  return CONFIGURABLE_PROVIDERS.includes(agent as ConfigurableProvider)
    ? `Agent/provider '${agent}' is deactivated. Launches bound to it are `
      + "blocked until it is activated in Settings → Model configuration, or "
      + "this configuration names another provider."
    : `Agent/provider '${agent}' is not supported.`;
}

export function launchBindingsByStateId(
  bindings: LaunchBinding[],
  issueTypeId: string | null,
): Map<string, LaunchBinding> {
  return new Map(
    bindings
      .filter((binding) => binding.issue_type_id === issueTypeId)
      .map((binding) => [binding.state_id, binding] as const),
  );
}

const text = (value: string | null | undefined) => value?.trim() ?? "";

export function validateLaunchBindingOptions(
  binding: LaunchBindingInput,
  capabilities: ProviderCapabilities[],
): LaunchBindingValidationError | null {
  const agent = text(binding.agent);
  const model = text(binding.model);
  const reasoning = text(binding.reasoning);
  if (!agent) {
    return model || reasoning ? {
      field: "agent",
      message: "Choose an agent/provider before configuring model or reasoning.",
    } : null;
  }

  const capability = capabilities.find((candidate) => candidate.agent === agent);
  if (!capability) {
    return { field: "agent", message: unavailableProviderMessage(agent) };
  }
  if (
    model &&
    !capability.accepts_any_model &&
    !(capability.model_aliases ?? []).includes(model) &&
    !(capability.model_prefixes ?? []).some((prefix) => model.startsWith(prefix))
  ) {
    return {
      field: "model",
      message: `Model '${model}' is not compatible with agent/provider '${agent}'.`,
    };
  }
  if (reasoning && !model) {
    return {
      field: "reasoning",
      message: "Choose a catalog model before configuring reasoning.",
    };
  }
  const reasoningLevels = model
    ? capability.model_reasoning_levels?.[model] ?? capability.reasoning_levels ?? []
    : capability.reasoning_levels ?? [];
  if (reasoning && !(reasoningLevels).includes(reasoning)) {
    return {
      field: "reasoning",
      message: `Reasoning '${reasoning}' is not supported by agent/provider '${agent}'.`,
    };
  }
  return null;
}

export function canAutoLaunchTo(
  binding: LaunchBinding | undefined,
  capabilities: ProviderCapabilities[],
): boolean {
  if (!binding) return false;
  return Boolean(
    text(binding.prompt) &&
    text(binding.agent) &&
    validateLaunchBindingOptions(binding, capabilities) === null,
  );
}
