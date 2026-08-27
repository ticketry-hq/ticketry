import { studioRuntime } from "../../runtime";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import { studioApolloClient } from "../../shared/apollo/client";
import type { ConfigPayload, Profile } from "../studio/lib/types";
import {
  AddLocalProfileDocument,
  DeleteLocalProfileDocument,
  LoadLocalSettingsDocument,
  ReplaceFeatureFlagsDocument,
  ReplaceLocalProfileDocument,
  SelectLocalProfileDocument,
} from "./generated/profileSettings.documents";
import type {
  LocalProfileInput,
  LocalSettingsFieldsFragment,
} from "./generated/profileSettings.documents";

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string"
    )),
  );
}

function mutablePayload(value: unknown): ConfigPayload {
  const payload = value as LocalSettingsFieldsFragment;
  return {
    recent_profile_index: payload.recent_profile_index,
    profiles: payload.profiles.map((profile) => ({
      ...profile,
      agent_prompts: stringRecord(profile.agent_prompts),
      module_links: profile.module_links.map((link) => ({ ...link })),
      recent_module_ids: stringRecord(profile.recent_module_ids),
    })),
    features: { ...payload.features },
  };
}

function input(profile: Partial<Profile>): LocalProfileInput {
  return profile as unknown as LocalProfileInput;
}

async function graphQl<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    return graphQlMutationError(error);
  }
}

export async function getConfig(): Promise<ConfigPayload> {
  const { data } = await studioApolloClient().query({
    query: LoadLocalSettingsDocument,
    fetchPolicy: "network-only",
  });
  if (!data) throw new Error("Local settings returned no data.");
  return mutablePayload(data.local_settings);
}

export function postProfile(profile: Partial<Profile>): Promise<ConfigPayload> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => mutablePayload(
      (await execute(AddLocalProfileDocument, { profile: input(profile) }))
        .add_local_profile,
    )),
  });
}

export function putProfile(
  index: number,
  profile: Partial<Profile>,
): Promise<ConfigPayload> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => mutablePayload(
      (await execute(ReplaceLocalProfileDocument, {
        index,
        profile: input(profile),
      })).replace_local_profile,
    )),
  });
}

export function deleteProfile(index: number): Promise<ConfigPayload> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => mutablePayload(
      (await execute(DeleteLocalProfileDocument, { index }))
        .delete_local_profile,
    )),
  });
}

export function patchConfig(body: {
  recent_profile_index: number;
}): Promise<ConfigPayload> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => mutablePayload(
      (await execute(SelectLocalProfileDocument, {
        index: body.recent_profile_index,
      })).select_local_profile,
    )),
  });
}

export function replaceFeatureFlags(features: {
  sidebar: boolean;
  projects: boolean;
}): Promise<ConfigPayload> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => mutablePayload(
      (await execute(ReplaceFeatureFlagsDocument, { features }))
        .replace_feature_flags,
    )),
  });
}
