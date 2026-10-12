import { capabilityOwnerLinkFindings } from "./rules/capability-owner-links.mjs";
import { duplicationBaselineFindings } from "./rules/duplication-baseline.mjs";
import { featureMapIndexFindings } from "./rules/feature-map-index.mjs";
import { featureMapLinkFindings } from "./rules/feature-map-links.mjs";
import { guidanceConsistencyFindings } from "./rules/guidance-consistency.mjs";
import { providerCatalogModuleFindings } from "./rules/provider-catalog-modules.mjs";

// Rule admission policy: a rule may block only when its violation is
// objectively detectable and a Supported-now replacement exists (see
// docs/feature-map/how-to-add-a-capability.md). Everything else is advisory.
const rules = [
  guidanceConsistencyFindings,
  featureMapLinkFindings,
  featureMapIndexFindings,
  capabilityOwnerLinkFindings,
  providerCatalogModuleFindings,
  duplicationBaselineFindings,
];

/**
 * Runs every reuse rule over already-loaded repository inputs.
 * Each finding is `{ id, file, line?, message }`; `id` is the stable identity.
 */
export function reuseFindings(inputs) {
  const blocking = [];
  const advisory = [];
  for (const rule of rules) {
    const result = rule(inputs);
    blocking.push(...(result.blocking ?? []));
    advisory.push(...(result.advisory ?? []));
  }
  return { blocking, advisory };
}
