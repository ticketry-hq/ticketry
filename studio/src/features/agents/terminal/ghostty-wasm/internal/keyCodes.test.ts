import { describe, expect, it } from "vitest";

import {
  GHOSTTY_MOD_CTRL,
  GHOSTTY_MOD_SHIFT,
  GHOSTTY_MOD_SUPER,
  ghosttyKeyName,
  ghosttyMods,
  unshiftedCodepoint,
} from "./keyCodes";

describe("DOM code to GhosttyKey name", () => {
  it("strips the letter prefix", () => {
    expect(ghosttyKeyName("KeyA")).toBe("A");
    expect(ghosttyKeyName("KeyZ")).toBe("Z");
  });

  it("separates trailing digits", () => {
    expect(ghosttyKeyName("Digit1")).toBe("DIGIT_1");
    expect(ghosttyKeyName("Numpad0")).toBe("NUMPAD_0");
    expect(ghosttyKeyName("LaunchApp1")).toBe("LAUNCH_APP_1");
  });

  it("keeps function keys unseparated", () => {
    expect(ghosttyKeyName("F1")).toBe("F1");
    expect(ghosttyKeyName("F12")).toBe("F12");
  });

  it("snake-cases the remaining code list", () => {
    expect(ghosttyKeyName("ArrowLeft")).toBe("ARROW_LEFT");
    expect(ghosttyKeyName("BracketRight")).toBe("BRACKET_RIGHT");
    expect(ghosttyKeyName("IntlBackslash")).toBe("INTL_BACKSLASH");
    expect(ghosttyKeyName("MediaPlayPause")).toBe("MEDIA_PLAY_PAUSE");
    expect(ghosttyKeyName("Enter")).toBe("ENTER");
  });

  it("reports an empty code as unidentified", () => {
    expect(ghosttyKeyName("")).toBe("UNIDENTIFIED");
  });
});

describe("modifier collection", () => {
  it("maps the DOM modifier flags onto Ghostty bits", () => {
    const mods = ghosttyMods({
      shiftKey: true,
      ctrlKey: true,
      altKey: false,
      metaKey: true,
      getModifierState: () => false,
    });
    expect(mods).toBe(GHOSTTY_MOD_SHIFT | GHOSTTY_MOD_CTRL | GHOSTTY_MOD_SUPER);
  });
});

describe("unshifted codepoints", () => {
  it("lowercases letter codes", () => {
    expect(unshiftedCodepoint("KeyA")).toBe("a".codePointAt(0));
  });

  it("reads digits and punctuation from the code", () => {
    expect(unshiftedCodepoint("Digit7")).toBe("7".codePointAt(0));
    expect(unshiftedCodepoint("Slash")).toBe("/".codePointAt(0));
  });

  it("reports nothing for keys whose unshifted value is layout-dependent", () => {
    expect(unshiftedCodepoint("ArrowUp")).toBe(0);
  });
});
