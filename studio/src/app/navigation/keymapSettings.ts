import {
  getKeybindingOverrides,
  putKeybindingOverrides,
} from "../../shared/api/client";
import {
  studioKeymapRegistry,
  type BindingOverride,
} from "./keymapRegistry";

export async function loadKeybindingOverrides(): Promise<void> {
  try {
    const { value } = await getKeybindingOverrides();
    studioKeymapRegistry.setOverrides(value);
  } catch (error) {
    studioKeymapRegistry.setOverrides([]);
    console.warn("[keymap] binding overrides unavailable; using defaults", error);
  }
}

export async function saveKeybindingOverrides(
  overrides: BindingOverride[],
): Promise<void> {
  const { value } = await putKeybindingOverrides(overrides);
  studioKeymapRegistry.setOverrides(value);
}
