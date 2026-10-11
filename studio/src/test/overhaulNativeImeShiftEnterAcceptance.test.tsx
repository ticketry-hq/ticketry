import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")(
  "[overhaul-826] preserves native IME ownership without leaking Shift+Enter to the terminal",
  async () => {
    const script = join(process.cwd(), "scripts/test-native-ghostty-ime-input.sh");
    const result = await promisify(execFile)("sh", [script]);
    expect(result.stdout).toContain(
      "native production host IME: no ESC CR during marked/consumed input; normal Shift+Enter/Enter and Ctrl/Alt/Cmd preserved; UTF-8 committed once",
    );
  },
  60_000,
);
