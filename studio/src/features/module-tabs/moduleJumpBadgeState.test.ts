import { describe, expect, it } from "vitest";

import type { KeyChord } from "../../app/navigation/keymapRegistry";
import {
  chordMatchesModifiers,
  modifierStateFromEvent,
  NO_MODIFIERS,
  sameModifierState,
} from "./moduleJumpBadgeState";

describe("module jump badge modifier state", () => {
  it("reads and compares only modifier keys", () => {
    const held = modifierStateFromEvent({
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
    });

    expect(held).toEqual({ ...NO_MODIFIERS, meta: true });
    expect(sameModifierState(held, { ...held })).toBe(true);
    expect(sameModifierState(held, { ...held, shift: true })).toBe(false);
  });

  it("requires the held modifiers to match the chord exactly", () => {
    const commandOne: KeyChord = {
      key: "1",
      alt: false,
      control: false,
      meta: true,
      shift: false,
    };

    expect(chordMatchesModifiers(commandOne, { ...NO_MODIFIERS, meta: true }))
      .toBe(true);
    expect(chordMatchesModifiers(commandOne, {
      ...NO_MODIFIERS,
      meta: true,
      shift: true,
    })).toBe(false);
  });
});
