import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("native Ghostty command routing acceptance", () => {
  it("[overhaul-178] gives only the focused, live Ghostty surface first refusal of its Command bindings", async () => {
    const [routing, owner, bridge] = await Promise.all([
      readFile(
        `${process.cwd()}/src-tauri/native/libghostty_command_routing.m`,
        "utf8",
      ),
      readFile(
        `${process.cwd()}/src-tauri/native/libghostty_surface_owner.m`,
        "utf8",
      ),
      readFile(
        `${process.cwd()}/src-tauri/native/libghostty_view_bridge.m`,
        "utf8",
      ),
    ]);

    const keyEquivalent = routing.match(
      /- \(BOOL\)performKeyEquivalent:[\s\S]*?\n}/,
    )?.[0];
    const free = bridge.match(
      /void muxed_ghostty_view_free[\s\S]*?\n}/,
    )?.[0];

    expect(keyEquivalent).toContain("muxed_ghostty_owned_surface");
    expect(keyEquivalent).toContain("self.window.firstResponder != self");
    expect(keyEquivalent).toContain("ghostty_surface_key_is_binding");
    expect(keyEquivalent).toContain("[self keyDown:event]");
    expect(keyEquivalent).toContain("return NO");
    expect(owner).toContain("owner->available = false");
    // Explicit detach owns the surface lifetime, even when AppKit or a
    // redraw waiter retains the view beyond detach.
    expect(free?.indexOf("muxed_ghostty_surface_owner_invalidate")).toBeLessThan(
      free?.indexOf("ghostty_surface_free") ?? 0,
    );
    expect(free).toContain("muxed_ghostty_take_view");
    expect(free).toContain("muxed_ghostty_surface_owner_invalidate");
  });
});
