import {
  LoadKeybindingSettingDocument,
  UpdateKeybindingSettingDocument,
} from "../../features/settings/generated/keybindings";
import { studioRuntime } from "../../runtime";
import {
  studioKeymapRegistry,
  type BindingOverride,
} from "./keymapRegistry";

export async function loadKeybindingOverrides(): Promise<void> {
  try {
    const { value } = await studioRuntime().readSettings({
      graphQl: async (execute) => ({
        value: (await execute(LoadKeybindingSettingDocument, {}))
          .keybinding_setting?.value ?? null,
      }),
    });
    studioKeymapRegistry.setOverrides(value);
  } catch (error) {
    studioKeymapRegistry.setOverrides([]);
    console.warn("[keymap] binding overrides unavailable; using defaults", error);
  }
}

export async function saveKeybindingOverrides(
  overrides: BindingOverride[],
): Promise<void> {
  const { value } = await studioRuntime().writeSettings({
    graphQl: async (execute) => ({
      value: (await execute(UpdateKeybindingSettingDocument, {
        value: overrides,
      })).update_keybinding_setting.value,
    }),
  });
  studioKeymapRegistry.setOverrides(value);
}
