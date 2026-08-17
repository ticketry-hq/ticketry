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

const NATIVE_TERMINAL_MODULES = [
  "../../src-tauri/src/native_terminal.rs",
  "../../src-tauri/src/native_terminal/macos/mod.rs",
  "../../src-tauri/src/native_terminal/macos/state.rs",
  "../../src-tauri/src/native_terminal/macos/lifecycle.rs",
  "../../src-tauri/src/native_terminal/macos/attach_commands.rs",
  "../../src-tauri/src/native_terminal/macos/presentation_commands.rs",
  "../../src-tauri/src/native_terminal/macos/platform_bridge.rs",
];

async function nativeTerminalSources(): Promise<string> {
  const sources = await Promise.all(
    NATIVE_TERMINAL_MODULES.map((module) => text(module)),
  );
  return sources.join("\n");
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
        "allow-desktop-append-frontend-log",
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
        "allow-native-terminal-hide",
        "allow-native-terminal-show",
        "allow-native-terminal-focus",
        "allow-native-terminal-detach",
        "core:event:allow-listen",
        "core:event:allow-unlisten",
        "core:webview:allow-set-webview-zoom",
      ],
    });
    expect(JSON.stringify(capability)).not.toContain("remote");
    expect(JSON.stringify(capability)).not.toContain("shell");
    expect(JSON.stringify(capability)).not.toContain("dialog:");
  });

  // Tauri defaults `dragDropEnabled` to true, which installs an OS drag
  // handler that returns `true` unconditionally. wry then never forwards the
  // drag to the webview, so no dragenter/dragover/drop ever reaches the page
  // and every in-app HTML5 drag (ticket reordering) silently does nothing —
  // while jsdom tests, which synthesize their own drag events, still pass.
  // The app consumes no native file-drop events, so this stays off.
  it("leaves HTML5 drag and drop to the webview instead of the OS handler", async () => {
    const configuration = await json("../../src-tauri/tauri.conf.json");
    const app = configuration.app as { windows: unknown[] };

    expect(app.windows).toEqual([
      expect.objectContaining({ label: "main", dragDropEnabled: false }),
    ]);
  });

  it("prefers native Ghostty when available and preserves the pooled fallback", async () => {
    const presenter = await text(
      "../../src/features/agents/terminal/Terminal.tsx",
    );

    expect(presenter).toContain("nativeGhosttyAvailable");
    expect(presenter).toContain("<NativeGhosttyTerminal");
    expect(presenter).toContain("<XtermTerminal");
    expect(presenter).toContain("if (!nativeFailureReason) return fallback");
    expect(presenter).toContain("onUnavailable={markNativeUnavailable}");
  });

  it("initializes packaged libghostty from Ticketry's bundled resources", async () => {
    const runtime = await text("../../src-tauri/native/libghostty_runtime.m");

    expect(runtime).toContain('setenv("GHOSTTY_RESOURCES_DIR"');
    expect(runtime).toContain('setenv("TERMINFO"');
    expect(
      runtime.indexOf("configure_bundled_ghostty_environment();"),
    ).toBeLessThan(runtime.indexOf("ghostty_init(1, argv)"));
  });

  it("launches tmux directly in libghostty without a Ticketry byte bridge", async () => {
    const nativeTerminal = await nativeTerminalSources();
    const tmuxViewer = await text("../../src-tauri/src/tmux_viewer.rs");
    const main = await text("../../src-tauri/src/main.rs");

    expect(nativeTerminal).toContain("TerminalCommandAttachment::prepare");
    expect(tmuxViewer).toContain('"attach-session"');
    expect(tmuxViewer).toContain('format!("/usr/bin/env {arguments}")');
    expect(nativeTerminal).not.toContain("UnixStream");
    expect(nativeTerminal).not.toContain("io::copy");
    expect(main).not.toContain("--muxed-ghostty-bridge");
  });

  it("positions the native terminal in the webview coordinate space", async () => {
    const nativeTerminal = await nativeTerminalSources();

    expect(nativeTerminal).toContain("webview_ns_view(&window)");
    expect(nativeTerminal).toContain("webview.inner() as usize");
    expect(nativeTerminal).not.toContain("window.ns_view()");
  });

  it("prepares libghostty hidden at the target window's Retina scale and keeps later scale updates", async () => {
    const view = await text("../../src-tauri/native/libghostty_view.m");
    const bridge = await text("../../src-tauri/native/libghostty_view_bridge.m");

    expect(view).not.toContain("NSScreen.mainScreen.backingScaleFactor");
    expect(view).toContain("self.window.backingScaleFactor ?: 1.0");
    expect(view).toContain("self.layer.contentsScale = scale");
    expect(view).toContain("ghostty_surface_set_content_scale(_surface, scale, scale)");
    expect(view.indexOf("self.hidden = YES")).toBeLessThan(
      view.indexOf("ghostty_surface_new(runtime->app, &config)"),
    );
    expect(view.indexOf("[parent addSubview:self")).toBeLessThan(
      view.indexOf("CGFloat scale = self.window.backingScaleFactor"),
    );
    expect(view).toContain("- (void)viewDidChangeBackingProperties");
    expect(bridge).toContain("muxed_ghostty_view_present");
  });

  it("keeps native viewer visibility reversible and hidden viewers non-interactive", async () => {
    const view = await text("../../src-tauri/native/libghostty_view.m");
    const bridge = await text("../../src-tauri/native/libghostty_view_bridge.m");
    const nativeTerminal = await nativeTerminalSources();
    const attachCommands = await text(
      "../../src-tauri/src/native_terminal/macos/attach_commands.rs",
    );
    const desktop = await text("../../src-tauri/src/lib.rs");
    const build = await text("../../src-tauri/build.rs");

    expect(build).toContain('"native_terminal_hide"');
    expect(build).toContain('"native_terminal_show"');
    expect(nativeTerminal).toContain("native_terminal_hide");
    expect(nativeTerminal).toContain("native_terminal_show");
    expect(desktop).toContain("native_terminal::native_terminal_hide");
    expect(desktop).toContain("native_terminal::native_terminal_show");
    expect(nativeTerminal).toContain("hidden native terminal cannot receive focus");
    expect(bridge).toContain("view->_acceptsInput = NO");
    expect(view).toContain("if (!_acceptsInput) return");
    expect(bridge).toContain("if (size.columns == 0 || size.rows == 0) return size");
    expect(bridge.indexOf("muxed_ghostty_view_set_frame(")).toBeLessThan(
      bridge.indexOf("muxed_ghostty_view_present(opaque)"),
    );
    const attach = attachCommands.match(
      /pub fn native_terminal_attach[\s\S]*?pub fn native_terminal_reconcile_frame/,
    )?.[0];
    expect(attach).toContain("visibility: NativeTerminalVisibility::hidden()");
    expect(attach).not.toContain("muxed_ghostty_view_present");
  });

  it("keeps steady-state libghostty render actions off AppKit's input path", async () => {
    const view = await text("../../src-tauri/native/libghostty_view.m");
    const runtimeAction = view.match(
      /static bool runtime_action\(ghostty_app_t[\s\S]*?\n}/,
    )?.[0];

    expect(runtimeAction).toContain("return false");
    expect(runtimeAction).not.toContain("ghostty_surface_draw");
  });

  it("forces and acknowledges the hidden Metal frame before presenting libghostty", async () => {
    const host = await text("../../src-tauri/native/libghostty_view_bridge.m");
    const armRedraw = host.match(
      /uint64_t muxed_ghostty_view_arm_redraw[\s\S]*?\n}/,
    )?.[0];

    expect(armRedraw).toContain("ghostty_surface_draw(view->_surface)");
    expect(armRedraw).toContain("[view recordRedraw]");
    expect(armRedraw!.indexOf("ghostty_surface_draw(view->_surface)")).toBeLessThan(
      armRedraw!.indexOf("[view recordRedraw]"),
    );
    expect(armRedraw).not.toContain("ghostty_surface_refresh(view->_surface)");
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
      "desktop:deploy": "npm run desktop:deploy --workspace @worktracker/studio",
      "deploy": "npm run desktop:deploy --workspace @worktracker/studio",
      "desktop:smoke": "npm run desktop:smoke --workspace @worktracker/studio",
      "desktop:smoke:dev": "npm run desktop:smoke:dev --workspace @worktracker/studio",
      "desktop:smoke:packaged": "npm run desktop:smoke:packaged --workspace @worktracker/studio",
    });
    expect(studioPackage.scripts).toMatchObject({
      "desktop:dev": "node scripts/desktop-dev.mjs",
      "desktop:build": "node scripts/release-build.mjs",
      "desktop:deploy": "node scripts/desktop-deploy.mjs",
      "release:build": "node scripts/release-build.mjs",
      "release:validate": "node scripts/release-build.mjs --validate",
      "release:test": "node --test scripts/release-build.test.mjs scripts/desktop-deploy.test.mjs scripts/installed-artifact-acceptance.test.mjs scripts/installed-artifact-acceptance-driver.test.mjs scripts/release-publish.test.mjs",
      "desktop:smoke": "vitest run src/test/desktopShellContract.test.ts && node --test scripts/desktop-concurrent-smoke.test.mjs && node scripts/desktop-smoke.mjs && cargo test --manifest-path src-tauri/Cargo.toml",
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
      icon: ["icons/icon.icns", "icons/icon.png"],
      resources: {
        "native/ticketry-ghostty.conf": "ticketry-ghostty.conf",
        "vendor/libghostty/resources/": "",
      },
      externalBin: ["binaries/muxed-backend", "binaries/ticketry-hook"],
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
