import { useQuery } from "@tanstack/react-query";
import { studioRuntime } from "../../runtime";
import type {
  ConfigurableProvider,
  ProviderCapabilities,
  ProviderCatalog,
} from "../../shared/api/types";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import {
  LoadProviderCatalogDocument,
  UpdateProviderCatalogDocument,
  type ProviderCatalogPayload,
} from "../settings/generated/providerCatalog";

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
      reasoning_levels: [
        ...new Set(Object.values(modelReasoningLevels).flat()),
      ],
      model_reasoning_levels: modelReasoningLevels,
      supports_unattended: provider.supports_unattended,
    };
  });
  return {
    catalog: {
      activated_providers: payload.configurable_providers
        .filter((provider) => provider.activated && isConfigurable(provider.slug))
        .map((provider) => provider.slug as ConfigurableProvider),
      global_default: payload.global_default &&
          isConfigurable(payload.global_default.provider)
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

async function fetchProviderHolding(): Promise<ProviderHolding> {
  return studioRuntime().readSettings({
    graphQl: async (execute) => holdingFromGraphQl(
      (await execute(LoadProviderCatalogDocument, {})).provider_catalog,
    ),
  });
}

const fetchHolding = async (force = false): Promise<ProviderHolding> => {
  if (force) {
    await queryClient.cancelQueries({
      queryKey: queryKeys.providers.catalog,
      exact: true,
    });
  }
  return queryClient.fetchQuery({
    queryKey: queryKeys.providers.catalog,
    queryFn: fetchProviderHolding,
    staleTime: 0,
  });
};

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
  const holding = await studioRuntime().writeSettings({
    graphQl: async (execute) => holdingFromGraphQl(
      (await execute(UpdateProviderCatalogDocument, {
        activatedProviders: catalog.activated_providers,
        defaultProvider: catalog.global_default?.provider ?? null,
        defaultModel: catalog.global_default?.model ?? null,
        defaultReasoning: catalog.global_default?.reasoning ?? null,
      })).update_provider_catalog,
    ),
  });
  queryClient.setQueryData(queryKeys.providers.catalog, holding);
  return holding.catalog;
}

export function setProviderCatalog(catalog: ProviderCatalog): void {
  queryClient.setQueryData<ProviderHolding>(
    queryKeys.providers.catalog,
    (current) => ({
      catalog,
      capabilities: current?.capabilities ?? [],
      configurableCapabilities: current?.configurableCapabilities ?? [],
    }),
  );
}

export function setProviderCapabilities(capabilities: ProviderCapabilities[]): void {
  queryClient.setQueryData<ProviderHolding>(
    queryKeys.providers.catalog,
    (current) => ({
      catalog: current?.catalog ?? {
        activated_providers: capabilities
          .map((capability) => capability.agent)
          .filter(isConfigurable),
        global_default: null,
      },
      capabilities,
      configurableCapabilities: current?.configurableCapabilities ?? capabilities,
    }),
  );
}

export function getProviderCapabilitiesSnapshot():
  | ProviderCapabilities[]
  | undefined {
  return queryClient.getQueryData<ProviderHolding>(
    queryKeys.providers.catalog,
  )?.capabilities;
}

export function useProviderCatalogQuery() {
  return useQuery(
    {
      queryKey: queryKeys.providers.catalog,
      queryFn: fetchProviderHolding,
      staleTime: 0,
      select: (holding) => holding.catalog,
    },
    queryClient,
  );
}

export function useProviderCapabilitiesQuery() {
  return useQuery(
    {
      queryKey: queryKeys.providers.catalog,
      queryFn: fetchProviderHolding,
      staleTime: 0,
      select: (holding) => holding.capabilities,
    },
    queryClient,
  );
}

export function useConfigurableProviderCapabilitiesQuery() {
  return useQuery(
    {
      queryKey: queryKeys.providers.catalog,
      queryFn: fetchProviderHolding,
      staleTime: 0,
      select: (holding) => holding.configurableCapabilities,
    },
    queryClient,
  );
}
