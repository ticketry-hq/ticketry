import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")(
  "[overhaul-270] ignores queued native terminal commands after their view is detached",
  async () => {
    const script = join(process.cwd(), "scripts/test-native-ghostty-webview-composition.sh");
    const result = await promisify(execFile)("sh", [script]);
    expect(result.stderr).toBe("");
  },
  30_000,
);
