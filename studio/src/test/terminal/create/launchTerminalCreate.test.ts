import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceTabsStore } from "../../../features/agents/terminal/internal/workspaceTabsStore";
import {
  beginTerminalCreate,
  hasInitialPrompt,
  launchScratchPlanning,
  useTerminalStore,
  type TerminalCreateFlow,
} from "../../../features/agents/terminal";

// The shared terminal-create launcher (CODIN-839). These prove the generic
// sequencing policy and the fixed scratch-planning launch contract, independent
// of Studio's modal wiring, so callers can trust the same seam.

function fakeFlow(overrides: Partial<TerminalCreateFlow> = {}): TerminalCreateFlow {
  return {
    hasModuleFolder: vi.fn(() => true),
    openFolderGate: vi.fn(),
    openPromptInput: vi.fn(),
    openAgentPicker: vi.fn(),
    ...overrides,
  };
}

describe("beginTerminalCreate sequencing policy", () => {
  const req = { projectId: "proj-1", moduleId: "mod-1" };

  it("opens the folder gate first when the module has no configured folder", () => {
    const flow = fakeFlow({ hasModuleFolder: vi.fn(() => false) });
    beginTerminalCreate(req, flow);
    expect(flow.openFolderGate).toHaveBeenCalledWith(req);
    expect(flow.openPromptInput).not.toHaveBeenCalled();
    expect(flow.openAgentPicker).not.toHaveBeenCalled();
  });

  it("opens the prompt step when a folder exists but no non-blank prompt is supplied", () => {
    const flow = fakeFlow();
    beginTerminalCreate({ ...req, initialPrompt: "   " }, flow);
    expect(flow.openPromptInput).toHaveBeenCalledOnce();
    expect(flow.openFolderGate).not.toHaveBeenCalled();
    expect(flow.openAgentPicker).not.toHaveBeenCalled();
  });

  it("skips the prompt step and goes straight to agent choice when a prompt is supplied", () => {
    const flow = fakeFlow();
    const supplied = { ...req, initialPrompt: "plan the epic" };
    beginTerminalCreate(supplied, flow);
    expect(flow.openAgentPicker).toHaveBeenCalledWith(supplied);
    expect(flow.openPromptInput).not.toHaveBeenCalled();
    expect(flow.openFolderGate).not.toHaveBeenCalled();
  });

  it("passes the caller's module context through (Studio callers pass it directly)", () => {
    const flow = fakeFlow();
    const spy = flow.hasModuleFolder as ReturnType<typeof vi.fn>;
    beginTerminalCreate({ projectId: "studio-proj", moduleId: "studio-mod" }, flow);
    expect(spy).toHaveBeenCalledWith("studio-mod");
  });
});

describe("hasInitialPrompt", () => {
  it("treats absent / blank prompts as no prompt", () => {
    expect(hasInitialPrompt({ projectId: "p", moduleId: "m" })).toBe(false);
    expect(hasInitialPrompt({ projectId: "p", moduleId: "m", initialPrompt: null })).toBe(false);
    expect(hasInitialPrompt({ projectId: "p", moduleId: "m", initialPrompt: "  " })).toBe(false);
    expect(hasInitialPrompt({ projectId: "p", moduleId: "m", initialPrompt: "x" })).toBe(true);
  });
});

describe("launchScratchPlanning launch contract", () => {
  beforeEach(() => {
    useTerminalStore.setState({ sessions: {} });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {}, chatByDoc: {} });
  });

  it("opens the scratch planning session with the fixed no-task contract", () => {
    const openSession = vi.fn(() => "tmp_1");
    useTerminalStore.setState({ openSession });
    const id = launchScratchPlanning({
      projectId: "proj-1",
      moduleId: "mod-1",
      agent: "claude",
      initialPrompt: "hello",
    });
    expect(id).toBe("tmp_1");
    expect(openSession).toHaveBeenCalledWith({
      taskId: null,
      projectId: "proj-1",
      moduleId: "mod-1",
      agent: "claude",
      ticketSeq: null,
      initialPrompt: "hello",
      isPlanning: true,
    });
  });
});
