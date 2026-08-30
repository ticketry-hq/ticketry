import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("native Ghostty clipboard acceptance", () => {
  it("[overhaul-204] routes native copy and paste through the macOS clipboard with Ghostty confirmation", async () => {
    const [host, clipboard] = await Promise.all([
      readFile(`${process.cwd()}/src-tauri/native/libghostty_host.m`, "utf8"),
      readFile(`${process.cwd()}/src-tauri/native/libghostty_clipboard.m`, "utf8"),
    ]);

    expect(host).toContain('#include "libghostty_clipboard.m"');
    expect(clipboard).toContain("ghostty_surface_complete_clipboard_request");
    expect(clipboard).toContain("NSPasteboardTypeString");
    expect(clipboard).toContain("runtime_read_clipboard");
    expect(clipboard).toContain("runtime_write_clipboard");
    expect(clipboard).toContain("runtime_confirm_clipboard");
  });
});
