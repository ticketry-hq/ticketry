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
    const rust = await text("../../src-tauri/src/desktop/service_health.rs");
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
        "allow-desktop-file-logging-enabled",
        "allow-desktop-append-frontend-log",
        "allow-desktop-retry-services",
        "allow-desktop-pick-folder",
        "allow-desktop-validate-module-folder",
        "allow-desktop-preflight-report",
        "allow-desktop-approve-executable-path",
        "allow-desktop-launch-default-coding-agent",
        "allow-desktop-update-check",
        "allow-desktop-update-download-and-install",
        "allow-desktop-update-restart",
        "allow-desktop-latest-crash-collection-outcome",
        "allow-desktop-reveal-crash-report-folder",
        "allow-TauRPC--graphql-execute",
        "allow-TauRPC--graphql-subscribe",
        "allow-TauRPC--graphql-unsubscribe",
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

  it("exposes only the permissioned desktop update actions through the updater plugin", async () => {
    const cargo = await text("../../src-tauri/Cargo.toml");
    const build = await text("../../src-tauri/build.rs");
    const run = await text("../../src-tauri/src/desktop/run.rs");
    const appUpdates = await text("../../src-tauri/src/app_updates/mod.rs");
    const capability = await json("../../src-tauri/capabilities/studio-main.json");
    const configuration = await json("../../src-tauri/tauri.conf.json");

    expect(cargo).toContain('tauri-plugin-updater = "2"');
    expect(run).toContain("tauri_plugin_updater::Builder::new().build()");
    expect(build).toContain('"desktop_update_check"');
    expect(build).toContain('"desktop_update_download_and_install"');
    expect(build).toContain('"desktop_update_restart"');
    expect(run).toContain("app_updates::desktop_update_check");
    expect(run).toContain("app_updates::desktop_update_download_and_install");
    expect(run).toContain("app_updates::desktop_update_restart");
    expect(appUpdates).toContain("pub(crate) async fn desktop_update_check");
    expect(appUpdates).toContain("UpdaterExt");
    expect(appUpdates).toContain("updater_builder()");
    expect(appUpdates).toContain('var("TICKETRY_UPDATE_FEED_URL")');

    const permissions = capability.permissions as string[];
    expect(permissions).toContain("allow-desktop-update-check");
    expect(permissions).toContain(
      "allow-desktop-update-download-and-install",
    );
    expect(permissions).toContain("allow-desktop-update-restart");
    expect(permissions.some((permission) => permission.startsWith("updater:")))
      .toBe(false);
    expect(configuration.plugins).toEqual({
      updater: {
        pubkey: expect.any(String),
        endpoints: [
          "https://github.com/ticketry-hq/ticketry-releases/releases/latest/download/latest.json",
        ],
      },
    });
    expect((configuration.bundle as Record<string, unknown>).createUpdaterArtifacts)
      .toBeUndefined();
  });

  it("installs and restarts through the same permissioned update seam", async () => {
    const build = await text("../../src-tauri/build.rs");
    const run = await text("../../src-tauri/src/desktop/run.rs");
    const appUpdates = await text("../../src-tauri/src/app_updates/mod.rs");
    const install = await text("../../src-tauri/src/app_updates/install.rs");
    const lifecycle = await text("../../src-tauri/src/desktop/lifecycle.rs");

    for (const command of [
      "desktop_update_download_and_install",
      "desktop_update_restart",
    ]) {
      expect(build).toContain(`"${command}"`);
      expect(run).toContain(`app_updates::install::${command}`);
      expect(install).toContain(command);
    }

    // Both operations route through the one endpoint-overridable updater the
    // check already uses, so an acceptance feed cannot be reached by install
    // alone.
    expect(appUpdates).toContain("fn stable_channel_updater");
    expect(install).toContain("super::stable_channel_updater(&app)");

    // Restarting into an update performs the same teardown as a normal exit.
    expect(lifecycle).toContain("pub(crate) fn tear_down_before_exit");
    expect(lifecycle).toContain("release_data_directory_ownership(application)");
    expect(install).toContain(
      "crate::desktop::lifecycle::tear_down_before_exit(&handle)",
    );
    expect(run).toContain("tear_down_before_exit(application)");

    expect(install).toContain('"desktop-update-progress"');
  });

  it("runs the packaged update acceptance through the shipped update path", async () => {
    const run = await text("../../src-tauri/src/desktop/run.rs");
    const acceptance = await text("../../src-tauri/src/app_updates/acceptance.rs");

    // The harness only ever gets the real check, install, and restart.
    expect(acceptance).toContain("super::desktop_update_check(app.clone())");
    expect(acceptance).toContain(
      "super::install::desktop_update_download_and_install(app.clone())",
    );
    expect(acceptance).toContain("super::install::restart_into_update(&app)");
    // No launch without the harness environment performs an acceptance run.
    expect(acceptance).toContain('"TICKETRY_UPDATE_ACCEPTANCE_RESULT"');
    expect(acceptance).toContain("AcceptanceRun::from_environment");
    expect(run).toContain("app_updates::acceptance::run_if_requested");
    expect(acceptance).not.toContain("dangerous");
  });

  it("exposes only fixed Crash Report outcome and reveal commands", async () => {
    const build = await text("../../src-tauri/build.rs");
    const run = await text("../../src-tauri/src/desktop/run.rs");
    const commands = await text(
      "../../src-tauri/src/desktop/crash_reports.rs",
    );
    const capability = await json(
      "../../src-tauri/capabilities/studio-main.json",
    );

    for (const command of [
      "desktop_latest_crash_collection_outcome",
      "desktop_reveal_crash_report_folder",
    ]) {
      expect(build).toContain(`"${command}"`);
      expect(run).toContain(`crash_reports::${command}`);
      expect(commands).toContain(`pub(crate) fn ${command}`);
    }
    expect(run).toContain("CrashReportsRuntime::new(");
    expect(run).toContain(".manage(crash_reports)");
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "allow-desktop-latest-crash-collection-outcome",
        "allow-desktop-reveal-crash-report-folder",
      ]),
    );
    expect(JSON.stringify(capability)).not.toContain("shell:");
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
    const tmuxViewer = await text(
      "../../src-tauri/src/terminal/viewer/tmux_client.rs",
    );
    const tmuxAdapter = await text("../../src-tauri/src/tmux_adapter.rs");
    const main = await text("../../src-tauri/src/main.rs");

    expect(nativeTerminal).toContain("TerminalCommandAttachment::prepare");
    expect(tmuxAdapter).toContain('"attach-session"');
    expect(tmuxViewer).toContain('"/usr/bin/env {}"');
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
    const desktop = await text("../../src-tauri/src/desktop/run.rs");
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
      /pub(?:\(crate\))? fn native_terminal_attach[\s\S]*?pub(?:\(crate\))? fn native_terminal_reconcile_frame/,
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
    const rust = await text("../../src-tauri/src/desktop/commands.rs");
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
      "web": "node scripts/web-dev.mjs",
      "web:dev": "node scripts/web-dev.mjs --development-profile",
      "desktop:dev": "npm run desktop:dev --workspace @worktracker/studio --",
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
      "release:test": "node --test scripts/release-build.test.mjs scripts/desktop-deploy.test.mjs scripts/installed-artifact-acceptance.test.mjs scripts/installed-artifact-acceptance-driver.test.mjs scripts/release-publish.test.mjs scripts/public-update-publisher.test.mjs scripts/update-acceptance.test.mjs scripts/update-acceptance-driver.test.mjs",
      "release:acceptance": "node scripts/installed-artifact-acceptance.mjs",
      "release:acceptance:update": "node scripts/update-acceptance.mjs",
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
      externalBin: ["binaries/ticketry-hook"],
      macOS: {
        minimumSystemVersion: "11.0",
        hardenedRuntime: true,
        entitlements: "entitlements.plist",
      },
    });
  });

  it("keeps desktop smoke free of retired Python service endpoints", async () => {
    const smoke = await text("../../scripts/desktop-smoke.mjs");

    expect(smoke).not.toContain("MUXED_DESKTOP_WORKTRACKER_API");
    expect(smoke).not.toContain("MUXED_DESKTOP_AGENT_API");
    expect(smoke).not.toContain("MUXED_DESKTOP_STATUS_API");
    expect(smoke).not.toContain("assertDevelopmentEndpointAgreement");
    expect(smoke).toContain("MUXED_DATA_DIR");
  });
});
