import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauri.listen,
}));

vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: () => null,
  registerPoolDriver: () => () => {},
  releasePooledTransport: vi.fn(),
  syncEntries: vi.fn(),
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe("native viewer attachment acceptance", () => {
  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    vi.resetAllMocks();
    installDesktopGraphQlRuntime();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({ activeByTask: {} });
    useTerminalStore.setState({
      sessions: {
        "session-1": {
          sessionId: "session-1",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
        },
      },
      sessionByRun: { "run-1": "session-1" },
    });
    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") {
        return Promise.resolve(true);
      }
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_set_frame") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_show") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });
  });

  it("[overhaul-62] clears the workspace tab boundary and sits flush at the bottom without moving the side native edges", () => {
    const view = render(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" />,
    );
    const host = view.getByTestId("native-terminal-host");

    expect(host).toHaveClass(
      "bottom-0",
      "left-2",
      "right-2",
      "top-[10px]",
    );
    expect(host).not.toHaveClass("bottom-2");
    expect(host).not.toHaveClass("inset-2");
    view.unmount();
  });

  it("[overhaul-63] matches Ghostty's background seams to Studio's pane panel", async () => {
    const view = render(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" />,
    );
    const host = view.getByTestId("native-terminal-host");
    expect(host).toHaveClass("bg-pane-panel");
    expect(host.parentElement).toHaveClass("bg-pane-panel");
    view.unmount();

    const { readFile } = await import("node:fs/promises");
    const [runtimeSource, viewSource, themeSource, tauriConfig] = await Promise.all([
      readFile(`${process.cwd()}/src-tauri/native/libghostty_runtime.m`, "utf8"),
      readFile(`${process.cwd()}/src-tauri/native/libghostty_view.m`, "utf8"),
      readFile(`${process.cwd()}/src-tauri/native/ticketry-ghostty.conf`, "utf8"),
      readFile(`${process.cwd()}/src-tauri/tauri.conf.json`, "utf8"),
    ]);
    expect(themeSource).toContain("background = #111317");
    expect(tauriConfig).toContain('"native/ticketry-ghostty.conf"');
    expect(tauriConfig).toContain('"vendor/libghostty/resources/"');
    expect(runtimeSource).toContain("load_ticketry_ghostty_theme(runtime->config)");
    expect(runtimeSource).toContain("ghostty_config_load_file(config");
    expect(runtimeSource).toContain("ticketry_ghostty_background_is_configured");
    expect(viewSource).toContain("muxed_ghostty_background_color().CGColor");
  });

  it("[overhaul-66] hides Ghostty behind Studio modals and restores its measured pane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const ready = vi.fn();
    const view = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={ready}
      />,
    );
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());

    act(() => {
      useModalStore.setState({ modalStack: [{ type: "settings" }] });
    });
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_hide", {
        handle: "native-1",
      });
    });

    act(() => {
      useModalStore.setState({ modalStack: [] });
    });
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_show", {
        handle: "native-1",
        frame: {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          viewportWidth: 800,
          viewportHeight: 600,
        },
      });
    });
    view.unmount();
  });

  it("[overhaul-64] discards native surfaces before a WebView reload remeasures the pane", async () => {
    const [shellSource, nativeTerminalSource] = await Promise.all([
      import("node:fs/promises").then(async ({ readFile }) =>
        [
          await readFile(`${process.cwd()}/src-tauri/crates/ticketry-desktop/src/desktop/run.rs`, "utf8"),
          await readFile(`${process.cwd()}/src-tauri/crates/ticketry-desktop/src/desktop/lifecycle.rs`, "utf8"),
        ].join("\n"),
      ),
      import("node:fs/promises").then(async ({ readFile }) =>
        [
          await readFile(`${process.cwd()}/src-tauri/crates/ticketry-desktop/src/native_terminal/macos/state.rs`, "utf8"),
          await readFile(`${process.cwd()}/src-tauri/crates/ticketry-desktop/src/native_terminal/macos/teardown.rs`, "utf8"),
        ].join("\n"),
      ),
    ]);

    expect(shellSource).toMatch(
      /PageLoadEvent::Started[\s\S]{0,240}detach_transient_viewers_for_page_load\(webview\.app_handle\(\)\)/,
    );
    expect(shellSource).toMatch(
      /fn detach_transient_viewers[\s\S]{0,500}ViewerCommandState[\s\S]{0,500}NativeTerminalState/,
    );
    // Exit and an update relaunch share one teardown, and it is what detaches
    // the native surfaces.
    expect(shellSource).toMatch(
      /RunEvent::Exit[\s\S]{0,120}tear_down_before_exit\(application\)/,
    );
    expect(shellSource).toMatch(
      /fn tear_down_before_exit[\s\S]{0,300}detach_transient_viewers\(application\)/,
    );
    expect(nativeTerminalSource).toMatch(
      /fn cancel_all[\s\S]{0,180}generation[\s\S]{0,180}phase\.store\(FAILED/,
    );
    expect(nativeTerminalSource).toMatch(
      /fn detach_all[\s\S]{0,180}detach_every_viewer/,
    );
    const detachEveryViewerSource = nativeTerminalSource.slice(
      nativeTerminalSource.indexOf("fn detach_every_viewer"),
      nativeTerminalSource.indexOf("fn free_view_with_timing"),
    );
    expect(detachEveryViewerSource).toContain("attaching.cancel_all()");
    expect(detachEveryViewerSource).toContain("registry.drain()");
    expect(detachEveryViewerSource.indexOf("attaching.cancel_all()"))
      .toBeLessThan(detachEveryViewerSource.indexOf("registry.drain()"));
    // Tauri handles a main-thread dispatch inline when page-load teardown is
    // already on AppKit's thread. Cross a worker first so native frees run on
    // the next event-loop turn, after WebKit finishes committing navigation.
    expect(nativeTerminalSource).toMatch(
      /fn defer_native_frees[\s\S]{0,900}run_on_main_thread[\s\S]{0,300}dispatch_from_fresh_thread/,
    );
    expect(nativeTerminalSource).toMatch(
      /fn dispatch_from_fresh_thread[\s\S]{0,300}std::thread::Builder::new\(\)[\s\S]{0,300}\.spawn/,
    );
    expect(nativeTerminalSource).toMatch(
      /fn insert_entry[\s\S]{0,500}self\.is_current\(&registry\)/,
    );
  });

  it("[overhaul-65] keeps the native Ghostty grid inside the pane across fullscreen transitions", async () => {
    const { readFile } = await import("node:fs/promises");
    const [viewSource, viewBridgeSource, bridgeSource] = await Promise.all([
      readFile(`${process.cwd()}/src-tauri/native/libghostty_view.m`, "utf8"),
      readFile(`${process.cwd()}/src-tauri/native/libghostty_view_bridge.m`, "utf8"),
      Promise.all([
        "lifecycle.rs",
        "presentation_commands.rs",
        "attach_commands.rs",
        "teardown.rs",
      ].map((file) =>
        readFile(`${process.cwd()}/src-tauri/crates/ticketry-desktop/src/native_terminal/macos/${file}`, "utf8")
      )).then((sources) => sources.join("\n")),
    ]);

    expect(viewSource).toContain(
      "self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable",
    );
    expect(viewSource).toContain("self.layer.masksToBounds = YES");
    expect(viewSource).toContain("[self reportGridResize]");
    expect(viewSource).toContain(
      "if (!_reportsGridResize || _surface == NULL || _resizeCallback == NULL)",
    );
    expect(viewBridgeSource).toMatch(
      /muxed_ghostty_view_present[\s\S]{0,500}_reportsGridResize = YES[\s\S]{0,180}\[view reportGridResize\]/,
    );
    expect(viewBridgeSource).toMatch(
      /muxed_ghostty_view_hide[\s\S]{0,180}_reportsGridResize = NO/,
    );
    expect(bridgeSource).toContain("Some(report_grid_resize)");
    expect(bridgeSource).toContain(
      "NativeViewerCommand::Resize(grid.columns, grid.rows)",
    );
    expect(bridgeSource).toContain(
      "muxed_ghostty_view_disable_resize_callback(view as *mut c_void)",
    );
  });

  it("[overhaul-232] gives captured wheel gestures to the program and keeps shell scrollback in tmux", async () => {
    const { readFile } = await import("node:fs/promises");
    const viewSource = await readFile(
      `${process.cwd()}/src-tauri/native/libghostty_view.m`,
      "utf8",
    );
    const scrollMethod = viewSource.match(
      /- \(void\)scrollWheel:\(NSEvent \*\)event \{[\s\S]*?\n\}/,
    )?.[0];
    if (scrollMethod === undefined) {
      throw new Error("libghostty view must implement scrollWheel");
    }

    expect(scrollMethod).toContain("ghostty_surface_mouse_captured(_surface)");
    expect(scrollMethod).toContain("ghostty_surface_mouse_scroll(_surface");
    expect(scrollMethod).toContain("muxed_ghostty_normalize_scroll");
    expect(scrollMethod).toContain("_scrollCallback(_scrollContext");
    expect(scrollMethod.indexOf("ghostty_surface_mouse_captured(_surface)"))
      .toBeLessThan(scrollMethod.indexOf("muxed_ghostty_normalize_scroll"));

    const keyDownMethod = viewSource.match(
      /- \(void\)keyDown:\(NSEvent \*\)event \{[\s\S]*?\n\}/,
    )?.[0];
    expect(keyDownMethod).toContain("ghostty_surface_key(_surface, key)");
    expect(keyDownMethod).not.toContain("interpretKeyEvents");
  });
});
