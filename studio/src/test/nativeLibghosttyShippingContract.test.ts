import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function json(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(relativePath, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

async function text(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

/**
 * CODING-1486 — embedded native libghostty is the shipping desktop renderer.
 * These assertions keep the build wiring honest: a frontend default alone does
 * not put the native library in the binary or its resources in the bundle.
 */
describe("native libghostty shipping contract", () => {
  it("leaves native crash reporting to macOS and invalidates old build recipes", async () => {
    const prepare = await text("../../scripts/prepare-libghostty.sh");
    expect(prepare).toContain("-Dsentry=false");
    expect(prepare).toContain('"$VENDOR_DIR/BUILD_RECIPE"');
    expect(prepare).toContain('"$SCRIPT_DIR/libghostty-macos-static.patch" | shasum -a 256');
    expect(prepare).toContain("sentry_init|sentry_backend|google_breakpad");
    expect(prepare.indexOf("refusing to stage it")).toBeLessThan(
      prepare.indexOf('cp "$SOURCE_DIR/zig-out/lib/libghostty.a"'),
    );
  });
  it("ships native libghostty resources in the macOS bundle", async () => {
    const configuration = await json("../../src-tauri/tauri.conf.json");
    const { resources = {} } = configuration.bundle as {
      resources?: Record<string, string>;
    };

    expect(resources["native/ticketry-ghostty.conf"]).toBe("ticketry-ghostty.conf");
    expect(resources["vendor/libghostty/resources/"]).toBe("");
  });

  it("links native libghostty from the shipping Cargo package by default", async () => {
    const cargoToml = await text("../../src-tauri/Cargo.toml");

    expect(cargoToml).toMatch(/^default = \["native-libghostty"\]$/m);
  });

  it("prepares the pinned library before every desktop and release build", async () => {
    const studioPackage = await json("../../package.json");

    expect(studioPackage.scripts).toMatchObject({
      "libghostty:prepare": "sh scripts/prepare-libghostty.sh",
      "predesktop:build": "npm run libghostty:prepare",
      "predesktop:dev": "npm run libghostty:prepare",
      "prerelease:build": "npm run libghostty:prepare",
      // Every `npm run tauri -- build` path, including the packaged update
      // build, prepares the pinned library before cargo links it.
      pretauri: "npm run libghostty:prepare",
    });
    // CODING-1487 — the retired WASM renderer left no preparation step behind,
    // so a fresh clone can build the desktop app and the web bundle without
    // producing a WebAssembly artifact first.
    expect(JSON.stringify(studioPackage.scripts)).not.toContain("ghostty-vt");
    expect(studioPackage.scripts).not.toHaveProperty("predev");
    expect(studioPackage.scripts).not.toHaveProperty("prebuild");
  });

  it("keeps desktop smoke and packaged acceptance on the shipping feature set", async () => {
    const [smoke, acceptance] = await Promise.all([
      text("../../scripts/desktop-smoke.mjs"),
      text("../../scripts/desktop-agent-acceptance.mjs"),
    ]);

    // No `--features` flag is needed now that native is a default feature, but
    // neither build may opt out of default features.
    expect(smoke).toContain('[tauriCli, "build", "--no-bundle"]');
    expect(smoke).not.toContain("--no-default-features");
    expect(smoke).toContain("prepare-libghostty.sh");
    expect(acceptance).toContain('"desktop-acceptance"');
    expect(acceptance).not.toContain("--no-default-features");
    expect(acceptance).toContain('"libghostty:prepare"');
  });

  it("stages the native runtime resources beside unbundled binaries", async () => {
    const buildScript = await text("../../src-tauri/build.rs");

    // Native libghostty resolves its configuration and pinned resources
    // through NSBundle. A packaged .app gets them from bundle.resources, but
    // `tauri dev` and `tauri build --no-bundle` run a bare executable whose
    // bundle is its own directory. Without this staging, unbundled desktop
    // builds fail native initialization and fall back to xterm.
    expect(buildScript).toContain("stage_unbundled_ghostty_resources");
    expect(buildScript).toContain('profile.join("ticketry-ghostty.conf")');
    expect(buildScript).toContain('for resource in ["ghostty", "terminfo"]');
  });

  it("keeps the release manifest on the default feature set", async () => {
    const manifest = await json("../../release/manifest.v1.json");
    const { artifacts } = manifest as {
      artifacts: { tauri: { command: string[] } };
    };

    expect(artifacts.tauri.command).not.toContain("--no-default-features");
    // CODING-1487 — the shipping manifest no longer demands a WASM artifact
    // the build cannot produce.
    expect(JSON.stringify(manifest)).not.toContain("ghostty-vt");
  });
});
