import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

const tauri = path.join(process.cwd(), "src-tauri");
const desktop = path.join(tauri, "crates/app/ticketry-desktop");

it("[overhaul-500] requests terminal microphone access on a normal macOS desktop launch", async () => {
  const [info, entitlements, native, run, peripherals] = await Promise.all([
    readFile(path.join(tauri, "Info.plist"), "utf8"),
    readFile(path.join(tauri, "entitlements.plist"), "utf8"),
    readFile(path.join(desktop, "native/microphone_permission.m"), "utf8"),
    readFile(path.join(desktop, "src/desktop/run.rs"), "utf8"),
    readFile(path.join(desktop, "src/desktop/edition_peripherals.rs"), "utf8"),
  ]);

  expect(info).toMatch(/<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]*terminal[^<]*<\/string>/);
  expect(entitlements).toMatch(/<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);
  expect(native).toContain("authorizationStatusForMediaType:AVMediaTypeAudio");
  expect(native).toContain("AVAuthorizationStatusNotDetermined");
  expect(native).toContain("requestAccessForMediaType:AVMediaTypeAudio");
  expect(run).toMatch(/RunEvent::Ready[\s\S]*?!automated_startup_exit_requested\(\)[\s\S]*?request_microphone_on_ready\(\s*crate::desktop::microphone_permission::request,?\s*\)/);
  // CODING-2864: only editions granting voice transcription ask on Ready.
  expect(peripherals).toMatch(/fn request_microphone_on_ready\(request: impl FnOnce\(\)\) \{\s*if has\(EditionCapability::VoiceTranscription\) \{\s*request\(\);/);
});
