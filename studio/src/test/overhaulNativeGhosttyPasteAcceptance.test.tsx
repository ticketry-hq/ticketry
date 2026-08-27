import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("native Ghostty paste acceptance", () => {
  it("[overhaul-169] keeps multiline paste with its focused owner across workspace navigation", () => {
    const output = execFileSync(
      "sh",
      ["scripts/test-native-clipboard.sh", "workspace-navigation"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(output).toContain("workspace-navigation: ok");
  }, 60_000);

  it("[overhaul-170] rejects stale paste after retained viewer replacement and teardown", () => {
    const output = execFileSync(
      "sh",
      ["scripts/test-native-clipboard.sh", "retained-viewer-teardown"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(output).toContain("retained-viewer-teardown: ok");
  }, 60_000);
});
