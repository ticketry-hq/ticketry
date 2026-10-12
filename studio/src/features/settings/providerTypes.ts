/** Provider-selection and compatibility views assembled from catalog relationships. */
export interface ProviderCapabilities {
  agent: string;
  accepts_model: boolean;
  accepts_any_model: boolean;
  model_aliases?: string[];
  model_prefixes?: string[];
  reasoning_levels?: string[];
  /** Model-specific compatibility from the generated catalogue join rows. */
  model_reasoning_levels?: Record<string, string[]>;
  supports_unattended?: boolean;
}

// Host-wide provider activation plus the single global launch default
// (ADR-0015). The `agy` adapter stays in code but is not configurable here.
export type ConfigurableProvider = "claude" | "codex" | "gemini";
/** Settings choice resolves provider and model identities into configurable names. */
export interface GlobalLaunchDefault {
  provider: ConfigurableProvider;
  profile: string | null;
  model: string | null;
  reasoning: string | null;
}
/** Settings summary combines activation, profile choices and the global launch choice. */
export interface ProviderCatalog {
  activated_providers: ConfigurableProvider[];
  codex_profiles: string[];
  global_default: GlobalLaunchDefault | null;
}
/** Computed eligible state IDs indexed by issue type for subtree launch eligibility. */
export type SubtreeRunCapabilityMap = Record<string, string[]>;

