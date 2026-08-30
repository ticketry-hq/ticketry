import { studioRuntime } from "../../runtime";
import {
  LoadInstantLaunchSettingDocument,
  UpdateInstantLaunchSettingDocument,
} from "./generated/instantLaunch.documents";

export interface InstantLaunchSettings {
  initialPrompt: string;
  autoClose: boolean;
}

export const DEFAULT_INSTANT_LAUNCH_SETTINGS: InstantLaunchSettings = {
  initialPrompt: "",
  autoClose: false,
};

function decode(value: unknown): InstantLaunchSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_INSTANT_LAUNCH_SETTINGS;
  }
  const candidate = value as {
    initial_prompt?: unknown;
    auto_close?: unknown;
  };
  return {
    initialPrompt:
      typeof candidate.initial_prompt === "string"
        ? candidate.initial_prompt
        : "",
    autoClose:
      typeof candidate.auto_close === "boolean"
        ? candidate.auto_close
        : false,
  };
}

export async function loadInstantLaunchSettings(): Promise<InstantLaunchSettings> {
  const { value } = await studioRuntime().readSettings({
    graphQl: async (execute) => ({
      value: (await execute(LoadInstantLaunchSettingDocument, {}))
        .instant_launch_setting?.value ?? null,
    }),
  });
  return decode(value);
}

export async function saveInstantLaunchSettings(
  settings: InstantLaunchSettings,
): Promise<InstantLaunchSettings> {
  const { value } = await studioRuntime().writeSettings({
    graphQl: async (execute) => ({
      value: (await execute(UpdateInstantLaunchSettingDocument, {
        initialPrompt: settings.initialPrompt,
        autoClose: settings.autoClose,
      })).update_instant_launch_setting.value,
    }),
  });
  return decode(value);
}
