import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("native Ghostty paste acceptance", () => {
  it("[overhaul-135] completes Ghostty's standard clipboard request against its requesting native surface", async () => {
    const [clipboardSource, runtimeSource, viewSource] = await Promise.all([
      readFile(
        `${process.cwd()}/src-tauri/native/libghostty_clipboard.m`,
        "utf8",
      ),
      readFile(
        `${process.cwd()}/src-tauri/native/libghostty_runtime.m`,
        "utf8",
      ),
      readFile(`${process.cwd()}/src-tauri/native/libghostty_view.m`, "utf8"),
    ]);

    const readClipboard = clipboardSource.match(
      /static bool runtime_read_clipboard[\s\S]*?\n}/,
    )?.[0];
    const keyEquivalent = viewSource.match(
      /- \(BOOL\)performKeyEquivalent:[\s\S]*?\n}/,
    )?.[0];
    const keyDown = viewSource.match(/- \(void\)keyDown:[\s\S]*?\n}/)?.[0];

    expect(runtimeSource).toContain(
      ".read_clipboard_cb = runtime_read_clipboard",
    );
    expect(runtimeSource).toContain(
      ".confirm_read_clipboard_cb = runtime_confirm_clipboard",
    );
    expect(readClipboard).toContain("clipboard != GHOSTTY_CLIPBOARD_STANDARD");
    expect(readClipboard).toContain("[NSPasteboard generalPasteboard]");
    expect(readClipboard).toContain("stringForType:NSPasteboardTypeString");
    expect(readClipboard).not.toMatch(/value\.length|clearContents|setString/);
    expect(readClipboard?.indexOf("surface == NULL")).toBeLessThan(
      readClipboard?.indexOf("generalPasteboard") ?? 0,
    );

    expect(keyEquivalent).toContain("ghostty_surface_key_is_binding");
    expect(keyEquivalent).toContain("[self keyDown:event]");
    expect(keyDown).toContain("ghostty_surface_key(_surface, key)");
  });

  it("[overhaul-136] isolates retained paste owners and invalidates one before its surface is destroyed", async () => {
    const [clipboardSource, viewSource] = await Promise.all([
      readFile(
        `${process.cwd()}/src-tauri/native/libghostty_clipboard.m`,
        "utf8",
      ),
      readFile(`${process.cwd()}/src-tauri/native/libghostty_view.m`, "utf8"),
    ]);

    const owner = clipboardSource.match(
      /typedef struct \{[\s\S]*?\} muxed_ghostty_surface_owner_s;/,
    )?.[0];
    const readClipboard = clipboardSource.match(
      /static bool runtime_read_clipboard[\s\S]*?\n}/,
    )?.[0];
    const dealloc = viewSource.match(/- \(void\)dealloc \{[\s\S]*?\n}/)?.[0];

    expect(owner).toContain("ghostty_surface_t surface");
    expect(owner).toContain("void *viewer");
    expect(owner).not.toMatch(/NSString|char \*|value|clipboard/);
    expect(readClipboard).toContain("muxed_ghostty_surface_owner_s *owner");
    expect(readClipboard?.indexOf("muxed_ghostty_owned_surface(owner)")).toBeLessThan(
      readClipboard?.indexOf("generalPasteboard") ?? 0,
    );
    expect(dealloc?.indexOf("muxed_ghostty_surface_owner_invalidate")).toBeLessThan(
      dealloc?.indexOf("ghostty_surface_free") ?? 0,
    );
  });

  it("[overhaul-138] lets only the focused native terminal claim Cmd+V", async () => {
    const viewSource = await readFile(
      `${process.cwd()}/src-tauri/native/libghostty_view.m`,
      "utf8",
    );
    const keyEquivalent = viewSource.match(
      /- \(BOOL\)performKeyEquivalent:[\s\S]*?\n}/,
    )?.[0];

    expect(keyEquivalent).toContain("self.window.firstResponder != self");
    expect(keyEquivalent?.indexOf("firstResponder")).toBeLessThan(
      keyEquivalent?.indexOf("ghostty_surface_key_is_binding") ?? 0,
    );
    expect(keyEquivalent?.indexOf("firstResponder")).toBeLessThan(
      keyEquivalent?.indexOf("[self keyDown:event]") ?? 0,
    );
  });
});
