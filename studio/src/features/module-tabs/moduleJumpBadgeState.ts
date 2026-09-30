import type { KeyChord } from "../../app/navigation/keymapRegistry";

export interface ModifierState {
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

export const NO_MODIFIERS: ModifierState = {
  alt: false,
  control: false,
  meta: false,
  shift: false,
};

export function modifierStateFromEvent(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): ModifierState {
  return {
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

export function sameModifierState(
  left: ModifierState,
  right: ModifierState,
): boolean {
  return (
    left.alt === right.alt &&
    left.control === right.control &&
    left.meta === right.meta &&
    left.shift === right.shift
  );
}

export function chordMatchesModifiers(
  chord: KeyChord,
  held: ModifierState,
): boolean {
  return (
    chord.alt === held.alt &&
    chord.control === held.control &&
    chord.meta === held.meta &&
    chord.shift === held.shift
  );
}
