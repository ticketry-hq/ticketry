import type { TypePolicies } from "@apollo/client";

import { normalizedEntityPolicies } from "./cacheKeys";

export const typePolicies: TypePolicies = normalizedEntityPolicies();
