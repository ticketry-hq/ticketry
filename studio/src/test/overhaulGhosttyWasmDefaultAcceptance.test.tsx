import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_RENDERER,
  selectedTerminalRenderer,
} from "../features/agents/terminal/ghostty-wasm/rendererSelection";

describe("ghostty-wasm default renderer acceptance", () => {
  it("[overhaul-241] selects ghostty-wasm by default and requires its release artifact", async () => {
    expect(DEFAULT_TERMINAL_RENDERER).toBe("ghostty-wasm");
    expect(
      selectedTerminalRenderer({ developmentBuild: true, search: "" }),
    ).toBe("ghostty-wasm");
    expect(
      selectedTerminalRenderer({
        developmentBuild: false,
        search: "?terminalRenderer=xterm",
      }),
    ).toBe("ghostty-wasm");
    expect(
      selectedTerminalRenderer({
        developmentBuild: true,
        search: "?terminalRenderer=native",
      }),
    ).toBe("native");

    const [packageSource, releaseManifestSource] = await Promise.all([
      readFile(`${process.cwd()}/package.json`, "utf8"),
      readFile(`${process.cwd()}/release/manifest.v1.json`, "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>;
    };
    const releaseManifest = JSON.parse(releaseManifestSource) as {
      artifacts: { frontend: { required_outputs: string[] } };
    };

    expect(packageJson.scripts.predev).toBe("npm run ghostty-vt:prepare");
    expect(packageJson.scripts.prebuild).toBe("npm run ghostty-vt:prepare");
    expect(releaseManifest.artifacts.frontend.required_outputs).toContain(
      "dist/ghostty-vt/ghostty-vt.wasm",
    );
  });
});
