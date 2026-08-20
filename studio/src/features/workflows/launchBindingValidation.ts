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

/**
 * A client-side mirror of the server's `PROVIDER_CAPABILITIES`
 * (`worktracker/launch_capabilities.py`), used only to describe a provider the
 * user has just switched on. The capabilities payload carries activated
 * providers only, so until the save round-trips there is no entry for one — and
 * an empty placeholder made setting its reasoning take two saves with no
 * explanation. The authoritative payload still wins the moment it arrives.
 */
export const PROVIDER_CAPABILITY_DEFAULTS: Record<
  ConfigurableProvider,
  ProviderCapabilities
> = {
  claude: {
    agent: "claude",
    models: [],
  },
  codex: {
    agent: "codex",
    models: [],
  },
  gemini: {
    agent: "gemini",
    models: [],
  },
};

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

const USER_INVOKE_ONLY_SKILLS = new Set([
  "grill-with-docs",
  "implement",
  "setup-matt-pocock-skills",
  "to-spec",
  "to-tickets",
]);

export function entrySkillWarning(
  requiredSkills: string[],
  entrySkill: string | null | undefined,
): string | null {
  const misplaced = requiredSkills.filter(
    (skill) => USER_INVOKE_ONLY_SKILLS.has(skill) && skill !== text(entrySkill),
  );
  if (misplaced.length === 0) return null;
  return `${misplaced.join(", ")} can only start through user input. Select it as the entry skill.`;
}

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
  if (!model) {
    return reasoning ? {
      field: "model",
      message: "Choose a catalog model before configuring reasoning.",
    } : null;
  }
  const selectedModel = capability.models.find(
    (candidate) => candidate.name === model,
  );
  if (!selectedModel) {
    return {
      field: "model",
      message: `Model '${model}' is not compatible with agent/provider '${agent}'.`,
    };
  }
  if (reasoning && !selectedModel.reasoning_levels.includes(reasoning)) {
    return {
      field: "reasoning",
      message: `Reasoning '${reasoning}' is not supported by model '${model}'.`,
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
