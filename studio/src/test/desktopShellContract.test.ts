import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assertDevelopmentEndpointAgreement,
  buildDevelopmentSmokeConfiguration,
} from "../../scripts/desktop-smoke-config.mjs";

async function json(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(relativePath, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

async function text(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character, index) =>
    `${index === 0 ? "" : "_"}${character.toLowerCase()}`
  );
}

describe("desktop shell security contract", () => {
  it("keeps Rust and TypeScript service-health states in agreement", async () => {
    const rust = await text("../../src-tauri/src/lib.rs");
    const typescript = await text("../../src/runtime/contract.ts");
    const rustStates = rust
      .match(/enum ServiceHealthState \{(?<states>[^}]+)\}/s)
      ?.groups?.states
      .match(/\b[A-Z][A-Za-z]+\b/g)
      ?.map(snakeCase)
      .sort();
    const typescriptStates = typescript
      .match(/readonly state:\s*(?<states>[^;]+);/)
      ?.groups?.states
      .match(/"([^"]+)"/g)
      ?.map((state) => state.slice(1, -1))
      .sort();

    expect(rustStates).toContain("recovering");
    expect(typescriptStates).toEqual(rustStates);
  });

  it("grants only local main-window access to fixed desktop commands and native zoom", async () => {
    const configuration = await json("../../src-tauri/tauri.conf.json");
    const capability = await json("../../src-tauri/capabilities/studio-main.json");

    expect(configuration.app).toMatchObject({
      security: { capabilities: ["studio-main"] },
      windows: [{ label: "main", zoomHotkeysEnabled: true }],
    });
    expect(capability).toMatchObject({
      identifier: "studio-main",
      local: true,
      windows: ["main"],
      permissions: [
        "allow-desktop-runtime-configuration",
        "allow-desktop-retry-services",
        "allow-desktop-pick-folder",
        "allow-desktop-preflight-report",
        "allow-desktop-approve-executable-path",
        "allow-viewer-attach",
        "allow-viewer-input",
        "allow-viewer-resize",
        "allow-viewer-scroll",
        "allow-viewer-detach",
        "allow-viewer-status",
        "allow-native-terminal-available",
        "allow-native-terminal-attach",
        "allow-native-terminal-set-frame",
        "allow-native-terminal-focus",
        "allow-native-terminal-detach",
        "core:webview:allow-set-webview-zoom",
      ],
    });
    expect(JSON.stringify(capability)).not.toContain("remote");
    expect(JSON.stringify(capability)).not.toContain("shell");
    expect(JSON.stringify(capability)).not.toContain("dialog:");
  });

  it("keeps the service retry command free of webview-supplied values", async () => {
    const rust = await text("../../src-tauri/src/lib.rs");
    const build = await text("../../src-tauri/build.rs");
    const command = rust.match(
      /fn desktop_retry_services\((?<parameters>[^)]*)\)[^{]*\{/s,
    );

    expect(build).toContain("\"desktop_retry_services\"");
    expect(command?.groups?.parameters).not.toMatch(
      /\b(program|path|argument|port|environment)\b/i,
    );
  });

  it("exposes stable desktop development, production, and smoke commands", async () => {
    const rootPackage = await json("../../../package.json");
    const studioPackage = await json("../../package.json");
    const configuration = await json("../../src-tauri/tauri.conf.json");

    expect(rootPackage.scripts).toMatchObject({
      "dev": "npm run desktop:dev",
      "desktop:dev": "npm run desktop:dev --workspace @worktracker/studio",
      "desktop:build": "npm run desktop:build --workspace @worktracker/studio",
      "desktop:smoke": "npm run desktop:smoke --workspace @worktracker/studio",
      "desktop:smoke:dev": "npm run desktop:smoke:dev --workspace @worktracker/studio",
      "desktop:smoke:packaged": "npm run desktop:smoke:packaged --workspace @worktracker/studio",
    });
    expect(studioPackage.scripts).toMatchObject({
      "desktop:dev": "node scripts/desktop-dev.mjs",
      "desktop:build": "node scripts/release-build.mjs",
      "release:build": "node scripts/release-build.mjs",
      "release:validate": "node scripts/release-build.mjs --validate",
      "release:test": "node --test scripts/release-build.test.mjs scripts/installed-artifact-acceptance.test.mjs scripts/release-publish.test.mjs",
      "desktop:smoke": "vitest run src/test/desktopShellContract.test.ts && node --test scripts/desktop-concurrent-smoke.test.mjs && cargo test --manifest-path src-tauri/Cargo.toml && node scripts/desktop-smoke.mjs",
      "desktop:smoke:dev": "node scripts/desktop-smoke.mjs dev",
      "desktop:smoke:packaged": "node scripts/desktop-smoke.mjs packaged",
    });
    expect(configuration.build).toEqual({
      beforeDevCommand: "npm run dev -- --host 127.0.0.1",
      devUrl: "http://127.0.0.1:5174",
      beforeBuildCommand: "npm run build",
      frontendDist: "../dist",
    });
    expect(configuration.bundle).toEqual({
      active: true,
      targets: ["app", "dmg"],
      externalBin: ["binaries/muxed-backend"],
      macOS: {
        minimumSystemVersion: "11.0",
        hardenedRuntime: true,
        entitlements: "entitlements.plist",
      },
    });
  });

  it("keeps development smoke runtime endpoints on the smoke webview port", () => {
    const configuration = buildDevelopmentSmokeConfiguration("15174");

    expect(configuration.runtimeEnvironment).toEqual({
      MUXED_DESKTOP_WORKTRACKER_API: "http://127.0.0.1:15174/api/work-tracker",
      MUXED_DESKTOP_AGENT_API: "http://127.0.0.1:15174/api",
      MUXED_DESKTOP_STATUS_API: "http://127.0.0.1:15174/api",
      MUXED_DESKTOP_STATUS_WEBSOCKET: "ws://127.0.0.1:15174/ws/status",
      MUXED_DESKTOP_TERMINAL_WEBSOCKET: "ws://127.0.0.1:15174/ws/terminal",
    });
    expect(() =>
      assertDevelopmentEndpointAgreement(
        configuration.webviewUrl,
        configuration.runtimeEnvironment,
      ),
    ).not.toThrow();
    expect(() =>
      assertDevelopmentEndpointAgreement(configuration.webviewUrl, {
        ...configuration.runtimeEnvironment,
        MUXED_DESKTOP_STATUS_API: "http://127.0.0.1:5174/api",
      }),
    ).toThrow("MUXED_DESKTOP_STATUS_API does not match the webview");
  });
});
