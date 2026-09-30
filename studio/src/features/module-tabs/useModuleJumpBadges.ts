import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { formatChordSymbols } from "../../app/navigation/chordLabel";
import { studioKeymapRegistry } from "../../app/navigation/keymapRegistry";
import { onNativeTerminalKeyboardEngaged } from "../../runtime/nativeTerminalKeyboard";
import {
  chordMatchesModifiers,
  modifierStateFromEvent,
  NO_MODIFIERS,
  sameModifierState,
} from "./moduleJumpBadgeState";

const MODULE_JUMP_ACTION_PREFIX = "modules.select-position-";
const MODULE_JUMP_POSITION_COUNT = 10;

export interface ModuleJumpBadgePresentation {
  label: string;
  position: number;
}

export function useModuleJumpBadges(
  enabled = true,
): ReadonlyMap<number, ModuleJumpBadgePresentation> {
  const [heldModifiers, setHeldModifiers] = useState(NO_MODIFIERS);
  const keymapRevision = useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
    studioKeymapRegistry.getRevision,
  );

  useEffect(() => {
    if (!enabled) {
      setHeldModifiers(NO_MODIFIERS);
      return;
    }

    const updateModifiers = (event: KeyboardEvent) => {
      const nextModifiers = modifierStateFromEvent(event);
      setHeldModifiers((currentModifiers) =>
        sameModifierState(currentModifiers, nextModifiers)
          ? currentModifiers
          : nextModifiers,
      );
    };
    const clearModifiers = () => setHeldModifiers(NO_MODIFIERS);

    window.addEventListener("keydown", updateModifiers, true);
    window.addEventListener("keyup", updateModifiers, true);
    window.addEventListener("blur", clearModifiers);
    document.addEventListener("pointerdown", clearModifiers, true);
    document.addEventListener("visibilitychange", clearModifiers);
    const stopNativeTerminalWatch =
      onNativeTerminalKeyboardEngaged(clearModifiers);

    return () => {
      window.removeEventListener("keydown", updateModifiers, true);
      window.removeEventListener("keyup", updateModifiers, true);
      window.removeEventListener("blur", clearModifiers);
      document.removeEventListener("pointerdown", clearModifiers, true);
      document.removeEventListener("visibilitychange", clearModifiers);
      stopNativeTerminalWatch();
    };
  }, [enabled]);

  return useMemo(() => {
    if (!enabled) return new Map();

    const badges = new Map<number, ModuleJumpBadgePresentation>();
    for (let position = 1; position <= MODULE_JUMP_POSITION_COUNT; position += 1) {
      const binding = studioKeymapRegistry.getEffectiveBinding(
        "capture",
        `${MODULE_JUMP_ACTION_PREFIX}${position}`,
      );
      if (
        !binding ||
        !chordMatchesModifiers(binding.chord, heldModifiers)
      ) continue;
      badges.set(position, {
        label: formatChordSymbols(binding.chord),
        position,
      });
    }
    return badges;
  }, [enabled, heldModifiers, keymapRevision]);
}
