import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalShell } from "../app/modal/ModalShell";
import IssueActionsMenu from "../app/shell/ticket-workspace/selected-ticket/details/IssueActionsMenu";
import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useNativeWebViewSiblingInteraction } from "../features/agents/terminal/internal/useNativeWebViewSiblingInteraction";
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

const FRAME = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  viewportWidth: 800,
  viewportHeight: 600,
};

function invocations(command: string): Record<string, unknown>[] {
  return tauri.invoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

function NativeSpikeHarness() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <>
      <NativeGhosttyTerminal
        sessionId="session-spike"
        owner="studio"
        webviewSiblingSpike
      />
      <button type="button" onClick={() => setModalOpen(true)}>
        Open spike modal
      </button>
      <IssueActionsMenu hasSubtasks={false} onDelete={async () => {}} />
      {modalOpen ? (
        <ModalShell title="Spike modal" onClose={() => setModalOpen(false)}>
          Native terminal stays attached beneath this translucent scrim.
        </ModalShell>
      ) : null}
    </>
  );
}

function RetainedNativeHosts({ second }: { second: boolean }) {
  return (
    <>
      <InteractionOwner handle="native-first" />
      {second ? <InteractionOwner handle="native-second" /> : null}
      <button type="button">WebView action</button>
    </>
  );
}

function DuplicateHandleHosts() {
  return (
    <>
      <InteractionOwner handle="native-shared" label="shared-first" />
      <InteractionOwner handle="native-shared" label="shared-second" />
    </>
  );
}

function InteractionOwner({
  handle,
  label = handle,
}: {
  handle: string;
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useNativeWebViewSiblingInteraction(handle, hostRef, true, false);
  return <div ref={hostRef} data-testid={label} />;
}

function FailingInteractionOwner({
  onFailure,
}: {
  onFailure: (error: unknown) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useNativeWebViewSiblingInteraction(
    "native-failing",
    hostRef,
    true,
    false,
    onFailure,
  );
  return <div ref={hostRef} />;
}

describe("native terminal below the WebView acceptance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
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
    useTerminalStore.setState({
      sessions: {
        "session-spike": {
          sessionId: "session-spike",
          taskId: "task-spike",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-spike",
        },
      },
      sessionByRun: { "run-spike": "session-spike" },
    });
    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "native_terminal_available") return true;
        if (
          command === "native_terminal_attach" ||
          command === "native_terminal_show" ||
          command === "native_terminal_set_frame" ||
          command === "native_terminal_reconcile_frame"
        ) {
          return {
            handle: (args?.handle as string | undefined) ?? "native-spike",
            runId: String(args?.runId ?? ""),
            columns: 100,
            rows: 30,
          };
        }
        return undefined;
      },
    );
  });

  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    vi.unstubAllGlobals();
  });

  it("[overhaul-233] keeps the native underlay experiment opt-in while normal terminals accept direct selection", async () => {
    const view = render(<NativeSpikeHarness />);
    const host = screen.getByTestId("native-terminal-host");

    expect(host).toHaveClass("bg-transparent");
    expect(host.parentElement).toHaveClass("bg-transparent");
    await waitFor(() =>
      expect(document.documentElement).toHaveClass(
        "native-webview-sibling-spike",
      ),
    );

    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: true,
        overlayFrames: [],
        generation: expect.any(Number),
      });
    });

    fireEvent.pointerDown(host);
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: false,
        overlayFrames: [],
        generation: expect.any(Number),
      });
    });

    fireEvent.blur(window);
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: true,
        overlayFrames: [],
        generation: expect.any(Number),
      });
    });

    fireEvent.pointerDown(host);
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: false,
        overlayFrames: [],
        generation: expect.any(Number),
      });
    });

    const tooltip = document.createElement("div");
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: true,
        overlayFrames: [FRAME],
        generation: expect.any(Number),
      });
    });
    tooltip.remove();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Issue actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Issue actions" }));
    await screen.findByRole("menu", { name: "Issue actions" });
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: true,
        overlayFrames: [FRAME],
        generation: expect.any(Number),
      });
    });

    fireEvent.click(screen.getByTestId("delete-issue"));
    fireEvent.click(screen.getByRole("button", { name: "Open spike modal" }));
    const dialog = await screen.findByRole("dialog", { name: "Spike modal" });
    expect(dialog.parentElement).toHaveAttribute("data-native-terminal-overlay");
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: true,
        overlayFrames: [FRAME],
        generation: expect.any(Number),
      });
    });

    expect(invocations("native_terminal_hide")).toHaveLength(0);
    expect(invocations("native_terminal_detach")).toHaveLength(0);
    expect(invocations("native_terminal_attach")).toHaveLength(1);

    const interactionCountBeforeClose = invocations(
      "native_terminal_set_webview_interaction",
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Spike modal" })).not.toBeInTheDocument(),
    );
    expect(invocations("native_terminal_set_webview_interaction")).toHaveLength(
      interactionCountBeforeClose,
    );
    expect(invocations("native_terminal_attach")).toHaveLength(1);

    fireEvent.pointerDown(host);
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-spike",
        webviewFocus: false,
        overlayFrames: [],
        generation: expect.any(Number),
      });
    });

    view.unmount();
    expect(document.documentElement).not.toHaveClass("native-webview-sibling-spike");

    const { readFile } = await import("node:fs/promises");
    const terminalSource = await readFile(
      `${process.cwd()}/src/features/agents/terminal/Terminal.tsx`,
      "utf8",
    );
    expect(terminalSource).not.toContain("webviewSiblingSpike");
    const nativeBridgeSource = await readFile(
      `${process.cwd()}/src-tauri/native/libghostty_view_bridge.m`,
      "utf8",
    );
    const presentSource = nativeBridgeSource.match(
      /bool muxed_ghostty_view_present[\s\S]*?\n}/,
    )?.[0];
    expect(presentSource).toContain(
      "muxed_ghostty_place_sibling(view, view->_webview, false)",
    );
    expect(presentSource).toContain("view->_acceptsInput = YES");
    const nativeTerminalSource = await readFile(
      `${process.cwd()}/src/features/agents/terminal/NativeGhosttyTerminal.tsx`,
      "utf8",
    );
    expect(nativeTerminalSource).toMatch(
      /useNativeWebViewSiblingInteraction\([\s\S]{0,180}webviewSiblingSpike && visible && presentedHere/,
    );
    const capability = await readFile(
      `${process.cwd()}/src-tauri/capabilities/studio-main.json`,
      "utf8",
    );
    expect(capability).toContain(
      '"allow-native-terminal-set-webview-interaction"',
    );
    const studioStyles = await readFile(
      `${process.cwd()}/src/app/styles/tailwind.css`,
      "utf8",
    );
    expect(studioStyles).toMatch(
      /html\.native-webview-sibling-spike \[data-pane="details-or-terminal"\][^{]*\{\s*background-color:\s*transparent;/s,
    );
  });

  it("keeps workspace transparency while another retained native host still owns it", async () => {
    const view = render(<RetainedNativeHosts second />);
    await waitFor(() =>
      expect(document.documentElement).toHaveClass(
        "native-webview-sibling-spike",
      ),
    );

    view.rerender(<RetainedNativeHosts second={false} />);
    expect(document.documentElement).toHaveClass(
      "native-webview-sibling-spike",
    );

    view.unmount();
    expect(document.documentElement).not.toHaveClass(
      "native-webview-sibling-spike",
    );
  });

  it("[overhaul-234] coordinates retained native terminals through one generation-fenced window selection", async () => {
    render(<RetainedNativeHosts second />);
    await waitFor(() =>
      expect(invocations("native_terminal_set_webview_interaction")).toHaveLength(2),
    );

    const initial = invocations("native_terminal_set_webview_interaction");
    expect(initial.map(({ handle, webviewFocus }) => ({ handle, webviewFocus }))).toEqual([
      { handle: "native-first", webviewFocus: true },
      { handle: "native-second", webviewFocus: true },
    ]);
    const initialGenerations = initial.map(({ generation }) => Number(generation));
    expect(initialGenerations[1]).toBe(initialGenerations[0] + 1);

    fireEvent.pointerDown(screen.getByTestId("native-first"));
    fireEvent.pointerDown(screen.getByTestId("native-second"));

    await waitFor(() =>
      expect(invocations("native_terminal_set_webview_interaction")).toHaveLength(4),
    );
    expect(invocations("native_terminal_set_webview_interaction").slice(2)).toEqual([
      {
        handle: "native-first",
        webviewFocus: false,
        overlayFrames: [],
        generation: initialGenerations[1] + 1,
      },
      {
        handle: "native-second",
        webviewFocus: false,
        overlayFrames: [],
        generation: initialGenerations[1] + 2,
      },
    ]);

    fireEvent.pointerDown(screen.getByRole("button", { name: "WebView action" }));
    await waitFor(() =>
      expect(invocations("native_terminal_set_webview_interaction").at(-1)).toEqual({
        handle: "native-second",
        webviewFocus: true,
        overlayFrames: [],
        generation: initialGenerations[1] + 3,
      }),
    );
  });

  it("publishes one selection when duplicate retained hosts share a native handle", async () => {
    render(<DuplicateHandleHosts />);
    await waitFor(() =>
      expect(invocations("native_terminal_set_webview_interaction")).toHaveLength(1),
    );
    const invocationCount = invocations(
      "native_terminal_set_webview_interaction",
    ).length;

    fireEvent.pointerDown(screen.getByTestId("shared-first"));

    await waitFor(() => {
      const pointerInvocations = invocations(
        "native_terminal_set_webview_interaction",
      ).slice(invocationCount);
      expect(pointerInvocations).toHaveLength(1);
      expect(pointerInvocations).toEqual([
        {
          handle: "native-shared",
          webviewFocus: false,
          overlayFrames: [],
          generation: expect.any(Number),
        },
      ]);
    });
  });

  it("reports a sibling-ordering failure so the renderer can fall back", async () => {
    const failure = new Error("native sibling ordering failed");
    const onFailure = vi.fn();
    tauri.invoke.mockRejectedValueOnce(failure);

    render(<FailingInteractionOwner onFailure={onFailure} />);

    await waitFor(() => expect(onFailure).toHaveBeenCalledWith(failure));
  });
});
