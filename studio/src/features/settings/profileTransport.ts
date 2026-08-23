import { studioRuntime } from "../../runtime";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import type { ConfigPayload, Profile } from "../studio/lib/types";
import {
  AddLocalProfileDocument,
  DeleteLocalProfileDocument,
  LoadLocalSettingsDocument,
  ReplaceFeatureFlagsDocument,
  ReplaceLocalProfileDocument,
  SelectLocalProfileDocument,
  type LocalProfileInput,
  type LocalSettingsPayload,
} from "./generated/profileSettings";

function mutablePayload(payload: LocalSettingsPayload): ConfigPayload {
  return {
    recent_profile_index: payload.recent_profile_index,
    profiles: payload.profiles.map((profile) => ({
      ...profile,
      agent_prompts: { ...profile.agent_prompts } as Record<string, string>,
      module_links: profile.module_links.map((link) => ({ ...link })),
      recent_module_ids: {
        ...profile.recent_module_ids,
      } as Record<string, string>,
    })),
    features: { ...payload.features },
  };
}

function input(profile: Partial<Profile>): LocalProfileInput {
  return profile as LocalProfileInput;
}

async function graphQl<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    return graphQlMutationError(error);
  }
}

export function getConfig(): Promise<ConfigPayload> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => mutablePayload(
      (await execute(LoadLocalSettingsDocument, {})).local_settings,
    ),
  });
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
