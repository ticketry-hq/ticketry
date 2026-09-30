import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "../features/agents/terminal/Terminal";
import { useTerminalStore, type SessionMeta } from "../features/agents/terminal/internal/sessionStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useModalStore } from "../app/modal/modalStore";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

const host = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  isTauri: () => true,
  Channel: class { onmessage: unknown = null; },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }));

// jsdom cannot paint xterm's canvas. Keep its external DOM/input contract;
// Terminal, the entry pool, Tauri transport and viewer leases all run normally.
vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element = document.createElement("div");
    input = document.createElement("textarea");
    output = document.createElement("pre");
    constructor() {
      this.input.setAttribute("aria-label", "Terminal input");
      this.element.append(this.input, this.output);
    }
    open(parent: HTMLElement) { parent.append(this.element); }
    write(data: string | Uint8Array) {
      this.output.textContent += typeof data === "string" ? data : new TextDecoder().decode(data);
    }
    onData(callback: (data: string) => void) {
      const listener = () => callback(this.input.value);
      this.input.addEventListener("input", listener);
      return { dispose: () => this.input.removeEventListener("input", listener) };
    }
    focus() { this.input.focus(); }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    dispose() { this.element.remove(); }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

type OutputChannel = { onmessage: (event: { type: "output"; data: number[] }) => void };
const outputs = new Map<string, OutputChannel>();
const reload = vi.fn();

function seed(run: string): SessionMeta {
  return {
    sessionId: `session-${run}`, agentRunId: run,
    taskId: "task-1", projectId: "project-1", moduleId: "module-1",
    agent: "codex", status: "ready", transport: "connecting",
    isPlanning: false, isInstant: false, initialPrompt: null,
  };
}

function receive(run: string, text: string) {
  act(() => outputs.get(run)!.onmessage({ type: "output", data: [...new TextEncoder().encode(text)] }));
}

async function checkIO(container: HTMLElement, run: string, text: string, sessionId = `session-${run}`) {
  await waitFor(() => expect(within(container).getByLabelText("Terminal input")).toBeVisible());
  receive(run, text);
  expect(within(container).getByTestId("terminal-host")).toHaveTextContent(text);
  const before = host.invoke.mock.calls.filter(([command]) => command === "viewer_input").length;
  fireEvent.input(within(container).getByLabelText("Terminal input"), { target: { value: `echo ${run}` } });
  expect(host.invoke.mock.calls.filter(([command]) => command === "viewer_input").slice(before)).toEqual([
    ["viewer_input", { viewerHandle: `viewer-${run}`, data: [...new TextEncoder().encode(`echo ${run}`)] }],
  ]);
  expect(within(container).queryByTestId("native-terminal-fallback-notice")).toBeNull();
  expect(useTerminalStore.getState().sessionByRun[run]).toBe(sessionId);
}

describe("native fallback transport acceptance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    outputs.clear();
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    Object.defineProperty(window, "location", {
      configurable: true, value: { ...window.location, reload },
    });
    installDesktopGraphQlRuntime();
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({ activeByTask: {} });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON: () => ({}),
    });
    host.listen.mockResolvedValue(() => {});
    host.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "native_terminal_available") return true;
      if (command === "native_terminal_attach") throw new Error("native attachment failed");
      if (command === "viewer_attach") {
        const run = String(args!.runId);
        outputs.set(run, args!.output as OutputChannel);
        return { viewerHandle: `viewer-${run}`, runId: run, lifecycle: "attached" };
      }
    });
  });

  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  it("[overhaul-115] keeps fallback input, output and session identity through switching, reopening and restoration with two live runs", async () => {
    const a = seed("fallback-io-a");
    const b = seed("fallback-io-b");
    useTerminalStore.setState({
      sessions: { [a.sessionId]: a, [b.sessionId]: b },
      sessionByRun: { [a.agentRunId!]: a.sessionId, [b.agentRunId!]: b.sessionId },
    });
    const view = render(<Terminal sessionId={a.sessionId} active />);
    await waitFor(() => expect(useTerminalStore.getState().sessions[a.sessionId]?.transport).toBe("ready"));
    await checkIO(view.container, a.agentRunId!, "first output");

    view.rerender(<Terminal sessionId={b.sessionId} active />);
    await waitFor(() => expect(useTerminalStore.getState().sessions[b.sessionId]?.transport).toBe("ready"));
    await checkIO(view.container, b.agentRunId!, "second output");
    view.rerender(<Terminal sessionId={a.sessionId} active />);
    await checkIO(view.container, a.agentRunId!, "after switching");
    view.rerender(<Terminal sessionId={null} />);
    view.rerender(<Terminal sessionId={a.sessionId} active />);
    await checkIO(view.container, a.agentRunId!, "after reopening");
    view.unmount();

    const restored = render(<Terminal sessionId={a.sessionId} active />);
    await waitFor(() => expect(host.invoke.mock.calls.filter(([command]) => command === "viewer_attach").length).toBeGreaterThanOrEqual(3));
    await checkIO(restored.container, a.agentRunId!, "after restoration");
    const other = render(<Terminal sessionId={b.sessionId} active owner="panel" />);
    await checkIO(other.container, b.agentRunId!, "simultaneous output");
    await checkIO(restored.container, a.agentRunId!, "still working");
    expect(within(restored.container).queryByText("simultaneous output")).toBeNull();
    expect(useTerminalStore.getState().sessionByRun).toEqual({
      "fallback-io-a": a.sessionId, "fallback-io-b": b.sessionId,
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("displays the xterm failure in its terminal when both attachments fail without refreshing Studio", async () => {
    const a = seed("fallback-both-fail");
    useTerminalStore.setState({ sessions: { [a.sessionId]: a }, sessionByRun: { [a.agentRunId!]: a.sessionId } });
    const invoke = host.invoke.getMockImplementation()!;
    host.invoke.mockImplementation((command: string, args?: Record<string, unknown>) =>
      command === "viewer_attach"
        ? Promise.reject({ code: "pty_failed", message: "xterm PTY unavailable" })
        : invoke(command, args),
    );
    const view = render(<Terminal sessionId={a.sessionId} active />);
    await waitFor(() => expect(view.getByTestId("terminal-host")).toHaveTextContent("xterm PTY unavailable"));
    expect(view.getByTestId("terminal-host")).toHaveTextContent("[disconnected]");
    expect(useTerminalStore.getState().sessions[a.sessionId]?.status).toBe("exited");
    expect(useTerminalStore.getState().sessionByRun[a.agentRunId!]).toBe(a.sessionId);
    expect(reload).not.toHaveBeenCalled();
  });

  it("selects a newly launched run after the first xterm ready frame rekeys its temporary tab", async () => {
    const run = "fallback-launch";
    const temporaryId = useTerminalStore.getState().openSession({
      taskId: "task-1", projectId: "project-1", moduleId: "module-1",
      agent: "codex", agentRunId: run,
    });
    function SelectedTerminal() {
      const sessionId = useTerminalStore((state) => state.sessionByRun[run] ?? null);
      return <Terminal sessionId={sessionId} active />;
    }
    const view = render(<SelectedTerminal />);
    await waitFor(() => expect(useTerminalStore.getState().sessions[`viewer-${run}`]?.transport).toBe("ready"));
    expect(useTerminalStore.getState().sessions[temporaryId]).toBeUndefined();
    await checkIO(view.container, run, "launch output", `viewer-${run}`);
    expect(host.invoke.mock.calls.filter(([command]) => command === "viewer_attach")).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
