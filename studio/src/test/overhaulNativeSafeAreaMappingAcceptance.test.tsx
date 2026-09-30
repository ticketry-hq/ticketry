import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("native Ghostty safe-area mapping acceptance", () => {
  it("maps browser viewport coordinates through the AppKit safe-area origin", async () => {
    const hostSource = await readFile(
      `${process.cwd()}/src-tauri/native/libghostty_view_bridge.m`,
      "utf8",
    );

    expect(hostSource).toContain(
      "NSRect viewport = coordinateView.safeAreaRect",
    );
    expect(hostSource).toContain(
      "[coordinateView convertRect:frame toView:parent]",
    );
    expect(hostSource).toContain(
      "frame.origin.y = NSMaxY(viewport) - (y + height) * scale_y",
    );
    expect(hostSource).not.toContain(
      "double scale_y = parent.bounds.size.height / viewport_height",
    );
  });
});
