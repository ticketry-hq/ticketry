import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function text(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("desktop Handy command contract", () => {
  it("registers one silent command, where voice transcription is granted, with the fixed executable and toggle argument", async () => {
    const [build, run, peripherals, handy, capabilityText] = await Promise.all([
      text("../../src-tauri/build.rs"),
      text("../../src-tauri/crates/app/ticketry-desktop/src/desktop/run.rs"),
      text("../../src-tauri/crates/app/ticketry-desktop/src/desktop/edition_peripherals.rs"),
      text("../../src-tauri/crates/app/ticketry-desktop/src/desktop/handy.rs"),
      text("../../src-tauri/capabilities/studio-main.json"),
    ]);
    const capability = JSON.parse(capabilityText) as { permissions: string[] };

    expect(build).toContain('"desktop_toggle_handy_transcription"');
    // CODING-2864: the command joins the invoke handler only in editions that
    // grant voice transcription; the desktop composition tests prove both.
    expect(run).toContain("edition_peripherals::with_voice_transcription_command(native_handler)");
    expect(peripherals).toContain("handy::desktop_toggle_handy_transcription");
    expect(peripherals).toMatch(/has\(EditionCapability::VoiceTranscription\)\s*&& invoke\.message\.command\(\) == HANDY_TOGGLE_COMMAND/);
    expect(capability.permissions).toContain(
      "allow-desktop-toggle-handy-transcription",
    );
    expect(handy.match(/#\[tauri::command\]/g)).toHaveLength(1);
    expect(handy).toContain('"/Applications/Handy.app/Contents/MacOS/handy"');
    expect(handy).toContain('"--toggle-transcription"');
    expect(handy).toContain(".spawn()");
    expect(handy).toContain('"debug"');
    expect(handy).not.toContain(".wait(");
  });
});
