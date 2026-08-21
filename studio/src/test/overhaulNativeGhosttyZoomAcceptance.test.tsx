import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("native Ghostty zoom acceptance", () => {
  it("[overhaul-128] gives Ghostty command-key bindings first refusal while its native view is engaged", async () => {
    const viewSource = await readFile(
      `${process.cwd()}/src-tauri/native/libghostty_view.m`,
      "utf8",
    );

    const keyEquivalent = viewSource.match(
      /- \(BOOL\)performKeyEquivalent:[\s\S]*?\n}/,
    )?.[0];

    expect(keyEquivalent).toContain("ghostty_surface_key_is_binding");
    expect(keyEquivalent).toContain("[self keyDown:event]");
    expect(keyEquivalent).toContain("return YES");
    expect(keyEquivalent?.indexOf("ghostty_surface_key_is_binding")).toBeLessThan(
      keyEquivalent?.indexOf("[self keyDown:event]") ?? 0,
    );
  });
});
