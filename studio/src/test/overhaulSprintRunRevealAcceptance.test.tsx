import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { AGENT_RUN_ACTIONS, studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal/appNavigation";
import { registerTerminalFocus } from "../features/agents/terminal/internal/terminalRegistry";
import { useClientStore } from "../state/clientStore";
import { grantsEveryLease } from "./desktopGraphQlRuntime";
import { documentOperationName } from "../graphql-foundation/typedDocument";

// Renderer IPC is the substituted platform boundary; navigation and cache are real.
const tauri = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => true,
  Channel: class { onmessage: unknown = null; },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
beforeEach(() => {
  window.history.replaceState({}, "", "/?terminalRenderer=native");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (media: string) => ({
    media, matches: false, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  tauri.listen.mockResolvedValue(() => {});
  tauri.invoke.mockImplementation(async (command: string, args?: { runId?: string; handle?: string; viewerHandle?: string }) => {
    if (command === "native_terminal_available") return true;
    if (["native_terminal_attach", "native_terminal_set_frame", "native_terminal_show"].includes(command)) {
      return { handle: args?.handle ?? "native-reveal", runId: args?.runId ?? "run-reveal", columns: 100, rows: 30 };
    }
    if (command === "viewer_attach" || command === "viewer_detach") {
      return {
        viewerHandle: args?.viewerHandle ?? "compatibility-reveal",
        runId: args?.runId ?? "run-reveal",
        lifecycle: command === "viewer_attach" ? "attached" : "closed",
      };
    }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

function mountReveal(f: ReturnType<typeof storySprintModuleBoundary>, options: Parameters<typeof f.mount>[0] = {}) {
  return f.mount({ ...options, graphQlExecute: (document, variables) => {
    if (["CreateViewerLease", "UpdateViewerLease", "DeleteViewerLease"].includes(documentOperationName(document))) {
      return grantsEveryLease(document, variables);
    }
    return f.execute(document, variables);
  } });
}

function runningStory(moduleId: string, taskId: string) {
  useAgentStatusStore.setState({ projectId: "project-1", runs: { "run-reveal": {
    agent_run_id: "run-reveal", project_id: "project-1", task_id: taskId,
    module_id: moduleId, agent: "codex", scope: "task", state: "working", updated_at: "2026-10-08T00:00:00Z",
  } }, automationAttempts: {}, automationByTask: {} });
  useTerminalStore.setState({ sessions: { "viewer-reveal": {
    sessionId: "viewer-reveal", taskId, projectId: "project-1", moduleId, agent: "codex", status: "ready",
    transport: "ready", isPlanning: false, isInstant: false, initialPrompt: null, agentRunId: "run-reveal",
  } }, sessionByRun: { "run-reveal": "viewer-reveal" } });
}

it("[overhaul-513] explicitly reveals an excluded run through real shell selection while preserving agent typing focus and session", async () => {
  const f = storySprintModuleBoundary(); mountReveal(f);
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), { target: { value: "hidingtarget" } });
  expect(screen.queryByRole("tab", { name: "0.2.0" })).not.toBeInTheDocument();
  runningStory("module-3", "release-25");
  const terminal = document.createElement("button"); document.body.appendChild(terminal);
  const unregister = registerTerminalFocus("viewer-reveal", () => terminal.focus());
  try {
    await act(async () => { expect(await studioKeymapRegistry.dispatch(AGENT_RUN_ACTIONS.focusAgentRun, { runId: "run-reveal" })).toBe(true); });
    await screen.findByRole("button", { name: "Sprint: All sprints" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("textbox", { name: "Search stories" })).toHaveValue("");
    expect(document.querySelector('[role="treeitem"][data-task-id="release-25"]')).toHaveAttribute("aria-selected", "true");
    expect(useClientStore.getState().selectedTaskId).toBe("release-25");
    expect(document.activeElement).toHaveAttribute("data-navigation-zone", "active-tab-body");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
    expect(useTerminalStore.getState().sessionByRun["run-reveal"]).toBe("viewer-reveal");
    expect(useAgentStatusStore.getState().runs["run-reveal"].state).toBe("working");
    expect(f.calls.filter((call) => /PlanWorkItem|Delete|Terminate/.test(call.operation))).toEqual([]);
  } finally { unregister(); terminal.remove(); }
});

it("[overhaul-517] an old automatic fallback folder completion cannot undo explicit run reveal", async () => {
  const { useModalStore } = await import("../app/modal/modalStore");
  const { ModalHost } = await import("../app/modal");
  const { setStorySprintFilterIntent } = await import("../features/work-items");
  const { seedModuleLinks, getModuleLinks } = await import("../features/module-links");
  const f = storySprintModuleBoundary();
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  mountReveal(f, { unlinked: ["module-2"], children: <ModalHost /> });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await act(async () => { setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }); });
  await screen.findByRole("dialog", { name: "Module Folder" });
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  const resume = (useModalStore.getState().modalStack[0].payload as { onSaved: () => void }).onSaved;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  runningStory("module-1", "roadmap-24");
  await act(async () => { expect(await studioKeymapRegistry.dispatch(AGENT_RUN_ACTIONS.focusAgentRun, { runId: "run-reveal" })).toBe(true); });
  await waitFor(() => expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24"));
  expect(screen.getByRole("button", { name: "Sprint: All sprints" })).toBeVisible();
  act(() => { seedModuleLinks([...getModuleLinks(), { id: "late-link", moduleId: "module-2", path: "/repos/bugs" }]); });
  await act(async () => { resume(); });
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24");
  expect(useTerminalStore.getState().sessionByRun["run-reveal"]).toBe("viewer-reveal");
});

it("[overhaul-518] revealing a module-scope run in an eligible module keeps the sprint restriction", async () => {
  const f = storySprintModuleBoundary(); mountReveal(f);
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  runningStory("module-1", "roadmap-24");
  const run = useAgentStatusStore.getState().runs["run-reveal"];
  useAgentStatusStore.setState({ runs: { "run-reveal": { ...run, scope: "shell", task_id: null } } });
  await act(async () => { expect(await studioKeymapRegistry.dispatch(AGENT_RUN_ACTIONS.focusAgentRun, { runId: "run-reveal" })).toBe(true); });
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
});
