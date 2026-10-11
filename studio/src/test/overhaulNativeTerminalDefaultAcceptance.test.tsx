import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  BROWSER_DEFAULT_TERMINAL_RENDERER,
  DESKTOP_DEFAULT_TERMINAL_RENDERER,
  selectedTerminalRenderer,
} from "../features/agents/terminal/internal/rendererSelection";

describe("native terminal default renderer acceptance", () => {
  it("[overhaul-241] renders desktop terminals natively and never falls back to WASM", async () => {
    expect(DESKTOP_DEFAULT_TERMINAL_RENDERER).toBe("native");
    expect(BROWSER_DEFAULT_TERMINAL_RENDERER).toBe("xterm");

    // A desktop build selects native without a flag, a stored setting, or a
    // diagnostic build override.
    expect(
      selectedTerminalRenderer({ developmentBuild: true, desktop: true, search: "" }),
    ).toBe("native");
    expect(
      selectedTerminalRenderer({ developmentBuild: false, desktop: true, search: "" }),
    ).toBe("native");
    // Packaged builds cannot be steered back to WASM.
    expect(
      selectedTerminalRenderer({
        developmentBuild: false,
        desktop: true,
        search: "?terminalRenderer=ghostty-wasm",
      }),
    ).toBe("native");
    // The desktop compatibility renderer is xterm, never WASM.
    expect(
      selectedTerminalRenderer({
        developmentBuild: false,
        desktop: true,
        search: "?terminalRenderer=xterm",
      }),
    ).toBe("native");
    // Development builds keep the diagnostic overrides.
    expect(
      selectedTerminalRenderer({
        developmentBuild: true,
        desktop: true,
        search: "?terminalRenderer=xterm",
      }),
    ).toBe("xterm");

    // The frontend default only matters if ordinary builds link the library
    // and ship its runtime resources.
    const [packageSource, cargoSource, tauriConfigurationSource, buildScript, ghosttyConfiguration] =
      await Promise.all([
        readFile(`${process.cwd()}/package.json`, "utf8"),
        readFile(`${process.cwd()}/src-tauri/Cargo.toml`, "utf8"),
        readFile(`${process.cwd()}/src-tauri/tauri.conf.json`, "utf8"),
        readFile(`${process.cwd()}/src-tauri/build.rs`, "utf8"),
        readFile(`${process.cwd()}/src-tauri/native/ticketry-ghostty.conf`, "utf8"),
      ]);
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>;
    };
    const tauriConfiguration = JSON.parse(tauriConfigurationSource) as {
      bundle: { resources: Record<string, string> };
    };

    expect(cargoSource).toMatch(/^default = \["native-libghostty"\]$/m);
    expect(packageJson.scripts["predesktop:build"]).toBe("bun run libghostty:prepare");
    expect(packageJson.scripts["predesktop:dev"]).toBe("bun run libghostty:prepare");
    expect(packageJson.scripts["prerelease:build"]).toBe("bun run libghostty:prepare");
    // CODING-1487 archived the WASM renderer, so no build hook prepares its
    // ghostty-vt artifact any more.
    for (const script of Object.values(packageJson.scripts)) {
      expect(script).not.toContain("ghostty-vt");
    }
    expect(tauriConfiguration.bundle.resources["vendor/libghostty/resources/"]).toBe("");
    // The native prompt binding sends the same ESC CR bytes as xterm.
    expect(ghosttyConfiguration.split(/\r?\n/).filter((line) => line.startsWith("keybind =")))
      .toEqual([String.raw`keybind = shift+enter=text:\x1b\r`]);
    expect(tauriConfiguration.bundle.resources["native/ticketry-ghostty.conf"])
      .toBe("ticketry-ghostty.conf");
    // A development build runs an unbundled binary, so the same resources are
    // staged beside it; otherwise native initialization fails and the desktop
    // silently renders with the xterm fallback.
    expect(buildScript).toContain("stage_unbundled_ghostty_resources");
    expect(buildScript).toContain('println!("cargo:rerun-if-changed={}", configuration.display())');
    expect(buildScript).toContain('fs::copy(&configuration, profile.join("ticketry-ghostty.conf"))');
  });
});
