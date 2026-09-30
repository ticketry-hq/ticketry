import type { TypePolicies } from "@apollo/client";

import { normalizedEntityPolicies } from "./cacheKeys";

const entityPolicies = normalizedEntityPolicies();

export const typePolicies: TypePolicies = {
  ...entityPolicies,
  ProviderCatalog: {
    keyFields: false,
    fields: { codex_profiles: { read: (value: string[] | undefined) => value ?? [] } },
  },
  WorktrackerProviderCatalog: {
    keyFields: false,
    fields: { codex_profiles: { read: (value: string[] | undefined) => value ?? [] } },
  },
  GlobalLaunchDefault: {
    keyFields: false,
    fields: { profile: { read: (value: string | null | undefined) => value ?? null } },
  },
  WorktrackerLaunchbinding: {
    ...entityPolicies.WorktrackerLaunchbinding,
    fields: { profile: { read: (value: string | null | undefined) => value ?? null } },
  },
};
