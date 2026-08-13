// Generated from operations/profileSettings.graphql. Do not edit manually.

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

const source = "fragment LocalSettingsFields on LocalSettings {\n  recent_profile_index\n  profiles {\n    name\n    workspace_slug\n    agent_prompt\n    agent_prompts\n    module_links {\n      module_id\n      path\n    }\n    recent_project_id\n    recent_module_ids\n  }\n  features {\n    sidebar\n    projects\n  }\n}\n\nquery LoadLocalSettings {\n  local_settings {\n    ...LocalSettingsFields\n  }\n}\n\nmutation AddLocalProfile($profile: LocalProfileInput!) {\n  add_local_profile(profile: $profile) {\n    ...LocalSettingsFields\n  }\n}\n\nmutation ReplaceLocalProfile($index: Int!, $profile: LocalProfileInput!) {\n  replace_local_profile(index: $index, profile: $profile) {\n    ...LocalSettingsFields\n  }\n}\n\nmutation DeleteLocalProfile($index: Int!) {\n  delete_local_profile(index: $index) {\n    ...LocalSettingsFields\n  }\n}\n\nmutation SelectLocalProfile($index: Int!) {\n  select_local_profile(index: $index) {\n    ...LocalSettingsFields\n  }\n}\n\nmutation ReplaceFeatureFlags($features: LocalFeatureFlagsInput!) {\n  replace_feature_flags(features: $features) {\n    ...LocalSettingsFields\n  }\n}";
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
