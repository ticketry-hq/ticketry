import { useQuery } from "@apollo/client/react";
import type {
  ConfigurableProvider,
  ProviderCapabilities,
  ProviderCatalog,
} from "../../shared/api/types";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  LoadProviderCatalogDocument,
  UpdateProviderCatalogDocument,
} from "../settings/generated/providerCatalog.documents";
import type {
  LoadProviderCatalogQuery,
} from "../settings/generated/providerCatalog.documents";

type ProviderCatalogPayload = LoadProviderCatalogQuery["provider_catalog"];

interface ProviderHolding {
  catalog: ProviderCatalog;
  capabilities: ProviderCapabilities[];
  configurableCapabilities: ProviderCapabilities[];
}

const isConfigurable = (slug: string): slug is ConfigurableProvider =>
  slug === "claude" || slug === "codex" || slug === "gemini";

function holdingFromGraphQl(payload: ProviderCatalogPayload): ProviderHolding {
  const reasoningNames = new Map(
    payload.reasoning_levels.map((level) => [level.id, level.name]),
  );
  const capabilitiesFor = (
    providers: ProviderCatalogPayload["providers"],
  ): ProviderCapabilities[] => providers.map((provider) => {
    const models = payload.agent_models.filter(
      (model) => model.provider === provider.id,
    );
    const modelReasoningLevels = Object.fromEntries(models.map((model) => [
      model.name,
      model.reasoning_levels.nodes.map(
        ({ reasoning_level_id: level }) => reasoningNames.get(level) ?? level,
      ),
    ]));
    return {
      agent: provider.slug,
      accepts_model: true,
      accepts_any_model: false,
      model_aliases: models.map((model) => model.name),
      model_prefixes: [],
      reasoning_levels: [...new Set(Object.values(modelReasoningLevels).flat())],
      model_reasoning_levels: modelReasoningLevels,
      supports_unattended: provider.supports_unattended,
    };
  });
  return {
    catalog: {
      activated_providers: payload.configurable_providers
        .filter((provider) => provider.activated && isConfigurable(provider.slug))
        .map((provider) => provider.slug as ConfigurableProvider),
      global_default: payload.global_default
        && isConfigurable(payload.global_default.provider)
        ? {
            provider: payload.global_default.provider,
            model: payload.global_default.model,
            reasoning: payload.global_default.reasoning,
          }
        : null,
    },
    capabilities: capabilitiesFor(payload.providers),
    configurableCapabilities: capabilitiesFor(payload.configurable_providers),
  };
}

async function fetchHolding(force = false): Promise<ProviderHolding> {
  const { data } = await studioApolloClient().query({
    query: LoadProviderCatalogDocument,
    fetchPolicy: force ? "network-only" : "cache-first",
  });
  return holdingFromGraphQl(data!.provider_catalog);
}

export async function loadProviderCatalog(): Promise<ProviderCatalog> {
  return (await fetchHolding()).catalog;
}

export async function loadProviderCapabilities(
  { force = false } = {},
): Promise<ProviderCapabilities[]> {
  return (await fetchHolding(force)).capabilities;
}

export async function loadConfigurableProviderCapabilities(): Promise<
  ProviderCapabilities[]
> {
  return (await fetchHolding()).configurableCapabilities;
}

export async function updateProviderCatalog(
  catalog: ProviderCatalog,
): Promise<ProviderCatalog> {
  const client = studioApolloClient();
  const { data } = await client.mutate({
    mutation: UpdateProviderCatalogDocument,
    variables: {
      activatedProviders: catalog.activated_providers,
      defaultProvider: catalog.global_default?.provider ?? null,
      defaultModel: catalog.global_default?.model ?? null,
      defaultReasoning: catalog.global_default?.reasoning ?? null,
    },
  });
  const payload = data!.update_provider_catalog;
  // The mutation field and catalogue query field have different root keys.
  // Publish the authoritative response into the one normalized holding so all
  // launch pickers converge in the same turn as the settings panel.
  client.writeQuery({
    query: LoadProviderCatalogDocument,
    data: { provider_catalog: payload } as LoadProviderCatalogQuery,
  });
  return holdingFromGraphQl(payload).catalog;
}

function providerPayloadSnapshot(): ProviderCatalogPayload | undefined {
  return studioApolloClient().readQuery({
    query: LoadProviderCatalogDocument,
    optimistic: true,
  })?.provider_catalog;
}

export function setProviderCatalog(catalog: ProviderCatalog): void {
  const current = providerPayloadSnapshot();
  if (!current) return;
  const activated = new Set(catalog.activated_providers);
  studioApolloClient().writeQuery({
    query: LoadProviderCatalogDocument,
    data: {
      provider_catalog: {
        configurable_providers: current.configurable_providers.map((provider) => ({
          ...provider,
          activated: activated.has(provider.slug as ConfigurableProvider),
        })),
        providers: [...current.providers],
        agent_models: current.agent_models.map((model) => ({
          ...model,
          reasoning_levels: { nodes: [...model.reasoning_levels.nodes] },
        })),
        reasoning_levels: [...current.reasoning_levels],
        global_default: catalog.global_default,
      },
    } as unknown as LoadProviderCatalogQuery,
  });
}

/**
 * Seed the catalog holding for callers that only know capabilities.
 *
 * Capabilities carry names, not row identities, so the rows written here are
 * synthetic and name-keyed. When the cached catalog already yields exactly
 * these capabilities — the workflow editor routing its own loaded
 * capabilities back — the write is skipped: replacing the real rows would
 * discard their catalog UUIDs, and the next launch-binding save would resolve
 * its model/reasoning against the synthetic rows and send names where the
 * host requires UUIDs, failing with "Enter a valid UUID.".
 */
export function setProviderCapabilities(capabilities: ProviderCapabilities[]): void {
  const snapshot = providerPayloadSnapshot();
  if (
    snapshot
    && JSON.stringify(holdingFromGraphQl(snapshot).capabilities)
      === JSON.stringify(capabilities)
  ) {
    return;
  }
  const reasoning = [...new Set(capabilities.flatMap((row) => row.reasoning_levels ?? []))];
  let reasoningRelationId = 0;
  const providers = capabilities.map((capability) => ({
    __typename: "WorktrackerProvider" as const,
    id: capability.agent,
    slug: capability.agent,
    activated: true,
    supports_unattended: capability.supports_unattended ?? false,
  }));
  studioApolloClient().writeQuery({
    query: LoadProviderCatalogDocument,
    data: {
      provider_catalog: {
        __typename: "ProviderCatalog" as const,
        configurable_providers: providers.filter((provider) => isConfigurable(provider.slug)),
        providers,
        agent_models: capabilities.flatMap((capability) =>
          (capability.model_aliases ?? []).map((name) => ({
            __typename: "WorktrackerAgentmodel" as const,
            id: `${capability.agent}:${name}`,
            provider: capability.agent,
            name,
            reasoning_levels: {
              __typename: "WorktrackerAgentmodelreasoninglevelConnection" as const,
              nodes: (capability.model_reasoning_levels?.[name]
                ?? capability.reasoning_levels
                ?? []).map((level) => ({
                  __typename: "WorktrackerAgentmodelreasoninglevel" as const,
                  id: ++reasoningRelationId,
                  reasoning_level_id: level,
                })),
            },
          })),
        ),
        reasoning_levels: reasoning.map((name) => ({
          __typename: "WorktrackerReasoninglevel" as const,
          id: name,
          name,
        })),
        global_default: null,
      },
    } as unknown as LoadProviderCatalogQuery,
  });
}

export function getProviderCapabilitiesSnapshot(): ProviderCapabilities[] | undefined {
  const payload = providerPayloadSnapshot();
  return payload ? holdingFromGraphQl(payload).capabilities : undefined;
}

export function useProviderCatalogQuery() {
  const query = useQuery(LoadProviderCatalogDocument, { client: studioApolloClient() });
  return {
    ...query,
    data: query.data
      ? holdingFromGraphQl(query.data.provider_catalog).catalog
      : undefined,
    isPending: query.loading,
    isError: Boolean(query.error),
  };
}

export function useProviderCapabilitiesQuery() {
  const query = useQuery(LoadProviderCatalogDocument, { client: studioApolloClient() });
  return {
    ...query,
    data: query.data
      ? holdingFromGraphQl(query.data.provider_catalog).capabilities
      : undefined,
    isPending: query.loading,
    isError: Boolean(query.error),
  };
}

export function useConfigurableProviderCapabilitiesQuery() {
  const query = useQuery(LoadProviderCatalogDocument, { client: studioApolloClient() });
  return {
    ...query,
    data: query.data
      ? holdingFromGraphQl(query.data.provider_catalog).configurableCapabilities
      : undefined,
    isPending: query.loading,
    isError: Boolean(query.error),
  };
}
