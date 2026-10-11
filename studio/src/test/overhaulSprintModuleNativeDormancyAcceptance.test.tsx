import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { grantsEveryLease } from "./desktopGraphQlRuntime";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { useTerminalStore } from "../features/agents/terminal";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { useModuleShellStore } from "../features/terminal-panel/moduleShellStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

function calls(command: string) { return tauri.invoke.mock.calls.filter(([name]) => name === command); }

afterEach(() => { cleanup(); useTerminalStore.setState({ sessions: {}, sessionByRun: {} }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("[overhaul-494] preserves native Story and shell viewers plus the document frame across zero-module recovery", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/?terminalRenderer=native");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  tauri.invoke.mockReset(); tauri.listen.mockResolvedValue(() => {});
  tauri.invoke.mockImplementation(async (command: string, args?: { runId?: string; handle?: string }) => {
    if (command === "native_terminal_available") return true;
    if (["native_terminal_attach", "native_terminal_set_frame", "native_terminal_show"].includes(command)) return {
      handle: args?.handle ?? `native-${args?.runId}`, runId: args?.runId ?? "run-story", columns: 100, rows: 30,
    };
  });
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  useTerminalPanelStore.setState({ openModules: { "module-1": true } });
  useModuleShellStore.setState({ byModule: { "module-1": { runIds: ["run-shell"], activeRunId: "run-shell", busy: false, problem: null, dead: {}, discovered: true } } });
  useTerminalStore.setState({ sessions: {
    "session-story": { sessionId: "session-story", taskId: "roadmap-24", projectId: "project-1", moduleId: "module-1", agent: "codex", status: "ready", transport: "ready", isPlanning: false, isInstant: false, initialPrompt: null, agentRunId: "run-story" },
    "session-shell": { sessionId: "session-shell", taskId: "__scratch__:module-1", projectId: "project-1", moduleId: "module-1", agent: null, status: "ready", transport: "ready", isPlanning: false, isInstant: false, initialPrompt: null, agentRunId: "run-shell" },
  }, sessionByRun: { "run-story": "session-story", "run-shell": "session-shell" } });
  const f = storySprintModuleBoundary();
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  const operations: string[] = [];
  const view = f.mount({ graphQlExecute: async (document, variables) => {
    const name = documentOperationName(document); operations.push(name);
    if (["CreateViewerLease", "UpdateViewerLease", "DeleteViewerLease"].includes(name)) return grantsEveryLease(document, variables);
    if (name === "RefreshTaskDocumentRegistry") return { refresh_task_document_registry: [{ __typename: "DesignDocuments", id: "design", relPath: "DESIGN.html", contentDigest: "digest" }] } as never;
    return f.execute(document, variables);
  } });
  act(() => {
    useClientStore.setState({ activeByTask: { "roadmap-24": "session-story" } });
    useClientStore.getState().setActive("roadmap-24", "terminal");
  });
  await waitFor(() => expect(calls("native_terminal_attach")).toHaveLength(2));
  await waitFor(() => expect(calls("native_terminal_show")).toHaveLength(2));
  const hosts = screen.getAllByTestId("native-terminal-host");
  const frame = await screen.findByTestId("workspace-doc-frame");
  const sessions = useTerminalStore.getState().sessionByRun;
  const hidesBefore = calls("native_terminal_hide").length;
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(await screen.findByRole("option", { name: /Empty sprint/ }));
  await screen.findByText("No modules have stories in this sprint.");
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBeNull());
  await waitFor(() => expect(calls("native_terminal_hide").length).toBeGreaterThan(hidesBefore));
  expect(hosts.every((host) => host.isConnected)).toBe(true);
  expect(frame.isConnected).toBe(true);
  expect(calls("native_terminal_detach")).toHaveLength(0);
  expect(operations.filter((name) => name === "DeleteViewerLease")).toHaveLength(0);
  expect(useTerminalStore.getState().sessionByRun).toEqual(sessions);
  fireEvent.click(screen.getByRole("button", { name: "Show all sprints" }));
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-1"));
  expect(screen.getByTestId("workspace-doc-frame")).toBe(frame);
  expect(hosts.every((host) => host.isConnected)).toBe(true);
  expect(calls("native_terminal_attach")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Sprint: All sprints" }));
  fireEvent.click(await screen.findByRole("option", { name: /Sprint 25/ }));
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-2"));
  expect(hosts[0]?.isConnected).toBe(true);
  expect(calls("native_terminal_attach")).toHaveLength(2);
  expect(operations.some((name) => /Terminate|DeleteTerminal|CreateTerminal/.test(name))).toBe(false);
  await act(async () => { view.unmount(); });
});
