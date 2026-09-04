import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function text(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("desktop Handy command contract", () => {
  it("registers one silent command with the fixed executable and toggle argument", async () => {
    const [build, run, handy, capabilityText] = await Promise.all([
      text("../../src-tauri/build.rs"),
      text("../../src-tauri/crates/app/ticketry-desktop/src/desktop/run.rs"),
      text("../../src-tauri/crates/app/ticketry-desktop/src/desktop/handy.rs"),
      text("../../src-tauri/capabilities/studio-main.json"),
    ]);
    const capability = JSON.parse(capabilityText) as { permissions: string[] };

    expect(build).toContain('"desktop_toggle_handy_transcription"');
    expect(run).toContain("handy::desktop_toggle_handy_transcription");
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
