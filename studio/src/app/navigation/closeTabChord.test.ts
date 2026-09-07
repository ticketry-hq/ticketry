import { describe, expect, it } from "vitest";

import { studioKeymapRegistry } from "./keymapRegistry";

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("close-tab chord", () => {
  it("resolves Cmd+W to close-tab alongside the default q binding", () => {
    expect(
      studioKeymapRegistry.resolve("global", keydown({ key: "w", metaKey: true })),
    ).toBe("close-tab");
    expect(studioKeymapRegistry.resolve("global", keydown({ key: "q" }))).toBe(
      "close-tab",
    );
    expect(studioKeymapRegistry.resolve("global", keydown({ key: "w" }))).toBeNull();
  });
});
