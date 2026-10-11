import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { focusTerminal } from "../features/agents/terminal/internal/terminalRegistry";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { NATIVE_TERMINAL_CHORD_EVENT } from "../app/navigation/nativeTerminalChords";
import { grantsEveryLease } from "./desktopGraphQlRuntime";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

const host = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(async (_event: string, _handler: (event: unknown) => void) => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }));
vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: () => null, registerPoolDriver: () => () => {}, releasePooledTransport: vi.fn(), syncEntries: vi.fn(),
}));

it("[overhaul-613] suppresses covered native rendering and focus, then restores the same viewer and session", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0,
    right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  const status = { handle: "manager-native", runId: "manager-run", columns: 100, rows: 30 };
  host.invoke.mockImplementation(async (command: string) => command === "native_terminal_available" ? true : status);
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  const session = { sessionId: "manager-session", taskId: "manager-story", projectId: "project-1", moduleId: "module-1",
    agent: "codex" as const, status: "ready" as const, transport: "ready" as const, isPlanning: false, isInstant: false,
    initialPrompt: null, agentRunId: "manager-run" };
  useTerminalStore.setState({ sessions: { "manager-session": session }, sessionByRun: { "manager-run": "manager-session" } });
  const boundary = storySprintModuleBoundary();
  const shell = boundary.mount({ shell: true, selectedTaskId: null,
    children: <NativeGhosttyTerminal sessionId="manager-session" owner="studio" />,
    graphQlExecute: async (document, variables) => /ViewerLease$/.test(documentOperationName(document))
      ? grantsEveryLease(document, variables) : boundary.execute(document, variables),
  });
  const calls = (command: string) => host.invoke.mock.calls.filter((call) => call[0] === command);
  try {
    await waitFor(() => expect(calls("native_terminal_show")).toHaveLength(1));
    fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
    await waitFor(() => expect(calls("native_terminal_hide")).toHaveLength(1));
    const focusCount = calls("native_terminal_focus").length;
    act(() => focusTerminal("manager-session"));
    expect(calls("native_terminal_focus")).toHaveLength(focusCount);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(calls("native_terminal_show")).toHaveLength(2));
    expect(calls("native_terminal_attach")).toHaveLength(1);
    expect(calls("native_terminal_detach")).toHaveLength(0);
    expect(useTerminalStore.getState().sessions["manager-session"]).toEqual(session);
    act(() => focusTerminal("manager-session"));
    await waitFor(() => expect(calls("native_terminal_focus")).toHaveLength(focusCount + 1));
    const chordListener = host.listen.mock.calls.find(([event]) => event === NATIVE_TERMINAL_CHORD_EVENT)?.[1];
    expect(chordListener).toBeDefined();
    act(() => chordListener?.({ payload: { handle: "manager-native", runId: "manager-run", chord: "module-manager" } }));
    expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
    await waitFor(() => expect(calls("native_terminal_hide")).toHaveLength(2));
    expect(calls("native_terminal_set_module_manager_shortcut").length).toBeGreaterThan(0);
  } finally {
    shell.unmount();
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
