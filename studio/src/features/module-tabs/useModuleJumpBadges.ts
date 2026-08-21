import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { formatChordSymbols } from "../../app/navigation/chordLabel";
import {
  studioKeymapRegistry,
  type KeyChord,
} from "../../app/navigation/keymapRegistry";
import { onNativeTerminalKeyboardEngaged } from "../../runtime/nativeTerminalKeyboard";

const MODULE_JUMP_ACTION_PREFIX = "modules.select-position-";
const MODULE_JUMP_POSITION_COUNT = 10;

interface ModifierState {
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

export interface ModuleJumpBadgePresentation {
  label: string;
  position: number;
}

const NO_MODIFIERS: ModifierState = {
  alt: false,
  control: false,
  meta: false,
  shift: false,
};

function modifierState(event: KeyboardEvent): ModifierState {
  return {
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

function modifiersMatch(left: ModifierState, right: ModifierState): boolean {
  return (
    left.alt === right.alt &&
    left.control === right.control &&
    left.meta === right.meta &&
    left.shift === right.shift
  );
}

function hasExactModifiers(chord: KeyChord, held: ModifierState): boolean {
  return (
    chord.alt === held.alt &&
    chord.control === held.control &&
    chord.meta === held.meta &&
    chord.shift === held.shift
  );
}

/**
 * Tracks the window's held modifiers and exposes truthful labels for the
 * effective module-position bindings. The binding registry decides whether a
 * position exists on this runtime and which chord its badge names.
 */
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
      const nextModifiers = modifierState(event);
      setHeldModifiers((currentModifiers) =>
        modifiersMatch(currentModifiers, nextModifiers)
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
      if (!binding || !hasExactModifiers(binding.chord, heldModifiers)) continue;
      badges.set(position, {
        label: formatChordSymbols(binding.chord),
        position,
      });
    }
    return badges;
  }, [enabled, heldModifiers, keymapRevision]);
}
