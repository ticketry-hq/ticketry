// Generated from operations/providerCatalog.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface CatalogProvider {
  readonly id: string;
  readonly slug: string;
  readonly activated: boolean;
  readonly supports_unattended: boolean;
}
export interface CatalogAgentModel {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly permitted_reasoning_levels: ReadonlyArray<string>;
}
export interface CatalogReasoningLevel { readonly id: string; readonly name: string; }
export interface CatalogGlobalDefault {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
}
export interface ProviderCatalogPayload {
  readonly configurable_providers: ReadonlyArray<CatalogProvider>;
  readonly providers: ReadonlyArray<CatalogProvider>;
  readonly agent_models: ReadonlyArray<CatalogAgentModel>;
  readonly reasoning_levels: ReadonlyArray<CatalogReasoningLevel>;
  readonly global_default: CatalogGlobalDefault | null;
}
export type LoadProviderCatalogVariables = Record<string, never>;
export interface LoadProviderCatalogQuery { readonly provider_catalog: ProviderCatalogPayload; }
export interface UpdateProviderCatalogVariables {
  readonly activatedProviders: ReadonlyArray<string>;
  readonly defaultProvider?: string | null;
  readonly defaultModel?: string | null;
  readonly defaultReasoning?: string | null;
}

const source = "query LoadProviderCatalog {\n  provider_catalog {\n    configurable_providers { id slug activated supports_unattended }\n    providers { id slug activated supports_unattended }\n    agent_models { id provider name permitted_reasoning_levels }\n    reasoning_levels { id name }\n    global_default { provider model reasoning }\n  }\n}\n\nmutation UpdateProviderCatalog(\n  $activatedProviders: [String!]!\n  $defaultProvider: String\n  $defaultModel: String\n  $defaultReasoning: String\n) {\n  update_provider_catalog(\n    activated_providers: $activatedProviders\n    default_provider: $defaultProvider\n    default_model: $defaultModel\n    default_reasoning: $defaultReasoning\n  ) {\n    configurable_providers { id slug activated supports_unattended }\n    providers { id slug activated supports_unattended }\n    agent_models { id provider name permitted_reasoning_levels }\n    reasoning_levels { id name }\n    global_default { provider model reasoning }\n  }\n}";
const document = <TResult, TVariables>(operationName: string): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document", operationName, source,
});
export const LoadProviderCatalogDocument = document<
  LoadProviderCatalogQuery, LoadProviderCatalogVariables
>("LoadProviderCatalog");
export const UpdateProviderCatalogDocument = document<
  { readonly update_provider_catalog: ProviderCatalogPayload }, UpdateProviderCatalogVariables
>("UpdateProviderCatalog");
