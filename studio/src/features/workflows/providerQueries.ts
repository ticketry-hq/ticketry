import { useQuery } from "@tanstack/react-query";
import type {
  ProviderCapabilities,
  ProviderCatalog,
} from "../../shared/api/types";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import * as settingsApi from "../studio/lib/api";
import * as workflowApi from "../studio/workflowApi";

const fetchProviderCatalog = async (): Promise<ProviderCatalog> =>
  (await settingsApi.getProviderCatalog()).value;

const fetchProviderCapabilities = (): Promise<ProviderCapabilities[]> =>
  workflowApi.getLaunchProviderCapabilities();

export function loadProviderCatalog(): Promise<ProviderCatalog> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.providers.catalog,
    queryFn: fetchProviderCatalog,
    staleTime: 0,
  });
}

export function loadProviderCapabilities({ force = false } = {}): Promise<
  ProviderCapabilities[]
> {
  if (force) return refreshProviderCapabilities();
  return queryClient.fetchQuery({
    queryKey: queryKeys.providers.capabilities,
    queryFn: fetchProviderCapabilities,
    staleTime: 0,
  });
}

async function refreshProviderCapabilities(): Promise<ProviderCapabilities[]> {
  await queryClient.cancelQueries({
    queryKey: queryKeys.providers.capabilities,
    exact: true,
  });
  const capabilities = await queryClient.fetchQuery({
    queryKey: queryKeys.providers.capabilities,
    queryFn: fetchProviderCapabilities,
    staleTime: 0,
  });
  return capabilities;
}

export function setProviderCatalog(catalog: ProviderCatalog): void {
  queryClient.setQueryData(queryKeys.providers.catalog, catalog);
}

export function setProviderCapabilities(
  capabilities: ProviderCapabilities[],
): void {
  queryClient.setQueryData(queryKeys.providers.capabilities, capabilities);
}

export function getProviderCapabilitiesSnapshot():
  | ProviderCapabilities[]
  | undefined {
  return queryClient.getQueryData(queryKeys.providers.capabilities);
}

export function useProviderCatalogQuery() {
  return useQuery(
    {
      queryKey: queryKeys.providers.catalog,
      queryFn: fetchProviderCatalog,
      staleTime: 0,
    },
    queryClient,
  );
}

export function useProviderCapabilitiesQuery() {
  return useQuery(
    {
      queryKey: queryKeys.providers.capabilities,
      queryFn: fetchProviderCapabilities,
      staleTime: 0,
    },
    queryClient,
  );
}
