import { useSyncExternalStore } from "react";

import { formatChordSymbols } from "./chordLabel";
import { studioKeymapRegistry } from "./keymapRegistry";

/** The effective global chord for an action in keycap form (⌘I, R), or null. */
export function globalShortcutLabel(actionId: string): string | null {
  const binding = studioKeymapRegistry.getEffectiveBinding("global", actionId);
  if (!binding) return null;
  // Letter keys read as keycaps (⌘I), whatever case the binding stores.
  const { key } = binding.chord;
  return formatChordSymbols({
    ...binding.chord,
    key: key.length === 1 ? key.toUpperCase() : key,
  });
}

/** `globalShortcutLabel`, re-rendering when the user rebinds the action. */
export function useGlobalShortcutLabel(actionId: string): string | null {
  useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
  );
  return globalShortcutLabel(actionId);
}
