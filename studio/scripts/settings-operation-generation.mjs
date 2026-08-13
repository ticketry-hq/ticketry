import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateSettingsOperations({ schemaPath, sourceRoot, outputRoot }) {
  const schema = await readFile(schemaPath, "utf8");
  for (const required of [
    "keybinding_setting: KeybindingSetting",
    "update_keybinding_setting(value: Json!): KeybindingSetting!",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Settings schema is missing ${required}`);
    }
  }

  const operationPath = join(
    sourceRoot,
    "features/settings/operations/keybindings.graphql",
  );
  const operations = (await readFile(operationPath, "utf8")).trim();
  const marker = "\n\nmutation UpdateKeybindingSetting";
  const split = operations.indexOf(marker);
  if (split < 0) {
    throw new Error(`${operationPath} has an unknown operation shape`);
  }
  const querySource = operations.slice(0, split);
  const mutationSource = `mutation UpdateKeybindingSetting${operations.slice(
    split + marker.length,
  )}`;
  const target = join(outputRoot, "settings");
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "keybindings.ts"),
    `// Generated from operations/keybindings.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface KeybindingSetting {
  readonly scope: "host";
  readonly key: "keybindings";
  readonly value: unknown;
  readonly updated_at: string;
}

export interface LoadKeybindingSettingQuery {
  readonly keybinding_setting: KeybindingSetting | null;
}

export type LoadKeybindingSettingVariables = Record<string, never>;

export interface UpdateKeybindingSettingMutation {
  readonly update_keybinding_setting: KeybindingSetting;
}

export interface UpdateKeybindingSettingVariables {
  readonly value: unknown;
}

export const LoadKeybindingSettingDocument: TypedDocumentNode<
  LoadKeybindingSettingQuery,
  LoadKeybindingSettingVariables
> = {
  kind: "Document",
  operationName: "LoadKeybindingSetting",
  source: ${JSON.stringify(querySource)},
};

export const UpdateKeybindingSettingDocument: TypedDocumentNode<
  UpdateKeybindingSettingMutation,
  UpdateKeybindingSettingVariables
> = {
  kind: "Document",
  operationName: "UpdateKeybindingSetting",
  source: ${JSON.stringify(mutationSource)},
};
`,
    "utf8",
  );

  await generateProfileOperations({ schema, sourceRoot, target });
  await generateProviderCatalogOperations({ schema, sourceRoot, target });
}

async function generateProviderCatalogOperations({ schema, sourceRoot, target }) {
  for (const required of [
    "provider_catalog: ProviderCatalog!",
    "update_provider_catalog(activated_providers: [String!]!, default_provider: String, default_model: String, default_reasoning: String): ProviderCatalog!",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Settings schema is missing ${required}`);
    }
  }
  const operationPath = join(
    sourceRoot,
    "features/settings/operations/providerCatalog.graphql",
  );
  const source = (await readFile(operationPath, "utf8")).trim();
  await writeFile(
    join(target, "providerCatalog.ts"),
    `// Generated from operations/providerCatalog.graphql. Do not edit manually.

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

const source = ${JSON.stringify(source)};
const document = <TResult, TVariables>(operationName: string): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document", operationName, source,
});
export const LoadProviderCatalogDocument = document<
  LoadProviderCatalogQuery, LoadProviderCatalogVariables
>("LoadProviderCatalog");
export const UpdateProviderCatalogDocument = document<
  { readonly update_provider_catalog: ProviderCatalogPayload }, UpdateProviderCatalogVariables
>("UpdateProviderCatalog");
`,
    "utf8",
  );
}

async function generateProfileOperations({ schema, sourceRoot, target }) {
  for (const required of [
    "local_settings: LocalSettings!",
    "add_local_profile(profile: LocalProfileInput!): LocalSettings!",
    "replace_local_profile(index: Int!, profile: LocalProfileInput!): LocalSettings!",
    "delete_local_profile(index: Int!): LocalSettings!",
    "select_local_profile(index: Int!): LocalSettings!",
    "replace_feature_flags(features: LocalFeatureFlagsInput!): LocalSettings!",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Settings schema is missing ${required}`);
    }
  }

  const operationPath = join(
    sourceRoot,
    "features/settings/operations/profileSettings.graphql",
  );
  const operations = (await readFile(operationPath, "utf8")).trim();
  await writeFile(
    join(target, "profileSettings.ts"),
    `// Generated from operations/profileSettings.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface LocalModuleLink {
  readonly module_id: string;
  readonly path: string;
}

export interface LocalProfile {
  readonly name: string;
  readonly workspace_slug: string;
  readonly agent_prompt: string | null;
  readonly agent_prompts: Readonly<Record<string, unknown>>;
  readonly module_links: ReadonlyArray<LocalModuleLink>;
  readonly recent_project_id: string | null;
  readonly recent_module_ids: Readonly<Record<string, unknown>>;
}

export interface LocalFeatureFlags {
  readonly sidebar: boolean;
  readonly projects: boolean;
}

export interface LocalSettingsPayload {
  readonly recent_profile_index: number | null;
  readonly profiles: ReadonlyArray<LocalProfile>;
  readonly features: LocalFeatureFlags;
}

export interface LocalProfileInput {
  readonly name: string;
  readonly workspace_slug: string;
  readonly agent_prompt?: string | null;
  readonly agent_prompts?: Readonly<Record<string, unknown>> | null;
  readonly module_links?: ReadonlyArray<LocalModuleLink> | null;
  readonly recent_project_id?: string | null;
  readonly recent_module_ids?: Readonly<Record<string, unknown>> | null;
}

export type LoadLocalSettingsVariables = Record<string, never>;
export interface LoadLocalSettingsQuery {
  readonly local_settings: LocalSettingsPayload;
}

export interface ProfileMutationVariables {
  readonly index?: number;
  readonly profile?: LocalProfileInput;
}

export interface FeatureFlagMutationVariables {
  readonly features: LocalFeatureFlags;
}

const source = ${JSON.stringify(operations)};
const document = <TResult, TVariables>(operationName: string): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document",
  operationName,
  source,
});

export const LoadLocalSettingsDocument = document<
  LoadLocalSettingsQuery,
  LoadLocalSettingsVariables
>("LoadLocalSettings");

export const AddLocalProfileDocument = document<
  { readonly add_local_profile: LocalSettingsPayload },
  ProfileMutationVariables
>("AddLocalProfile");

export const ReplaceLocalProfileDocument = document<
  { readonly replace_local_profile: LocalSettingsPayload },
  ProfileMutationVariables
>("ReplaceLocalProfile");

export const DeleteLocalProfileDocument = document<
  { readonly delete_local_profile: LocalSettingsPayload },
  ProfileMutationVariables
>("DeleteLocalProfile");

export const SelectLocalProfileDocument = document<
  { readonly select_local_profile: LocalSettingsPayload },
  ProfileMutationVariables
>("SelectLocalProfile");

export const ReplaceFeatureFlagsDocument = document<
  { readonly replace_feature_flags: LocalSettingsPayload },
  FeatureFlagMutationVariables
>("ReplaceFeatureFlags");
`,
    "utf8",
  );
}
