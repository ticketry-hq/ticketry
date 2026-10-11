import "./renderedTaskWorkspaceTerminalFixture";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { useModalStore } from "../app/modal/modalStore";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { ackTerminal, useTerminalStore } from "../features/agents/terminal";
import { useClientStore } from "../state/clientStore";
import { installWorkspaceNativeFocus, seedWorkspaceNativeRun } from "./renderedTaskWorkspaceNativeFocusFixture";

function workspace(active = true, conversationRunId?: string) {
  return <><button>Other control</button><TaskWorkspace bucket="story-a" projectId="project-1"
    moduleId="module-1" owner="studio" workspaceActive={active}
    conversationRunId={conversationRunId}
    details={<div>Issue details</div>} /></>;
}

function KeyboardWorkspace() {
  useGlobalKeymap();
  return workspace();
}

describe("overhaul acceptance — rendered workspace terminal focus", () => {
  let native: ReturnType<typeof installWorkspaceNativeFocus>;
  beforeEach(() => { native = installWorkspaceNativeFocus(); });
  afterEach(() => {
    cleanup();
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("[overhaul-724] gives the first activated native terminal input after presentation commits, retaining the durable run and terminal", async () => {
    const session = seedWorkspaceNativeRun("run-native-first");
    native.delayPresentation();
    render(workspace());
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await waitFor(() => expect(native.hasPendingShow()).toBe(true));
    expect(native.calls("native_terminal_focus")).toHaveLength(0);
    await act(async () => native.finishPresentation());
    await waitFor(() => expect(native.nativeOwnsKeyboard()).toBe(true));
    expect(native.calls("native_terminal_focus")).toContainEqual([
      "native_terminal_focus", { handle: "native-run-native-first" },
    ]);
    expect(native.calls("native_terminal_attach")).toEqual([
      ["native_terminal_attach", expect.objectContaining({ runId: "run-native-first" })],
    ]);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-native-first": session.sessionId });
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual([session.sessionId]);
    expect(native.calls("viewer_attach")).toHaveLength(0);
  });

  it("[overhaul-725] focuses compatibility input on the first activation after native attachment fails on the same run", async () => {
    const session = seedWorkspaceNativeRun("run-native-fallback");
    native.failAttachment();
    render(workspace());
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    const input = await screen.findByRole("textbox", { name: "Terminal input" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(native.calls("native_terminal_attach")).toEqual([
      ["native_terminal_attach", expect.objectContaining({ runId: "run-native-fallback" })],
    ]);
    expect(native.calls("viewer_attach")).toEqual([
      ["viewer_attach", expect.objectContaining({ runId: "run-native-fallback" })],
    ]);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-native-fallback": session.sessionId });
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual([session.sessionId]);
    fireEvent.input(input, { target: { value: "echo retained" } });
    expect(native.calls("viewer_input")).toContainEqual([
      "viewer_input", { viewerHandle: session.sessionId, data: [...new TextEncoder().encode("echo retained")] },
    ]);
  });

  it("[overhaul-726] cancels queued native focus when presentation authority is lost during input ownership transfer", async () => {
    seedWorkspaceNativeRun("run-native-away");
    native.delayOwnership();
    const view = render(workspace());
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await waitFor(() => expect(native.hasPendingOwnership()).toBe(true));
    expect(native.calls("native_terminal_focus")).toHaveLength(0);
    view.rerender(workspace(false));
    const other = screen.getByRole("button", { name: "Other control" });
    other.focus();
    await act(async () => native.finishOwnership());
    expect(other).toHaveFocus();
    expect(native.calls("native_terminal_focus")).toHaveLength(0);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-native-away": "session-run-native-away" });
    expect(native.calls("native_terminal_detach")).toHaveLength(0);
  });

  it("[overhaul-727] preserves first-press engaged fallback input through temporary-to-durable terminal rekey", async () => {
    native.failAttachment();
    useClientStore.setState({ sidebarVisible: false });
    const temporaryId = useTerminalStore.getState().openSession({
      taskId: "story-a", projectId: "project-1", moduleId: "module-1", agent: "codex",
    });
    render(workspace());
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await native.launches.request("story-a");
    fireEvent.mouseDown(screen.getByTestId("terminal-renderer-pending"));
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
    await native.launches.deliver("story-a", "run-engaged-rekey");
    const input = await screen.findByRole("textbox", { name: "Terminal input" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(useTerminalStore.getState().sessions[temporaryId]).toBeUndefined();
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-engaged-rekey": "session-run-engaged-rekey" });
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual(["session-run-engaged-rekey"]);
    expect(native.calls("viewer_attach")).toEqual([
      ["viewer_attach", expect.objectContaining({ runId: "run-engaged-rekey" })],
    ]);
  });

  it("[overhaul-728] cancels delayed native focus under a modal and restores engaged focus after authorized return", async () => {
    seedWorkspaceNativeRun("run-native-modal");
    useClientStore.setState({ sidebarVisible: false });
    native.delayOwnership();
    render(workspace());
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await waitFor(() => expect(native.hasPendingOwnership()).toBe(true));
    await act(async () => useModalStore.setState({ modalStack: [{ type: "agent-picker" }] }));
    const other = screen.getByRole("button", { name: "Other control" });
    other.focus();
    await act(async () => native.finishOwnership());
    expect(other).toHaveFocus();
    expect(native.calls("native_terminal_focus")).toHaveLength(0);
    await act(async () => useModalStore.setState({ modalStack: [] }));
    await waitFor(() => expect(native.nativeOwnsKeyboard()).toBe(true));
    expect(native.calls("native_terminal_attach")).toHaveLength(1);
    expect(native.calls("native_terminal_detach")).toHaveLength(0);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-native-modal": "session-run-native-modal" });
  });

  it("[overhaul-729] selects a native terminal from the edit-view tab strip without engaging input until Enter in its body", async () => {
    seedWorkspaceNativeRun("run-native-navigation");
    useClientStore.setState({ sidebarVisible: false, editViewZone: "tab-strip", navigationModality: "keyboard" });
    render(<KeyboardWorkspace />);
    await screen.findByRole("tab", { name: "codex terminal" });
    const strip = screen.getByRole("tablist", { name: "Workspace tabs" });
    strip.focus();
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    fireEvent.keyDown(strip, { key: "Enter" });
    await waitFor(() => expect(native.calls("native_terminal_show")).toHaveLength(1));
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    expect(native.calls("native_terminal_focus")).toHaveLength(0);
    const body = document.querySelector('[data-navigation-zone="active-tab-body"]')!;
    expect(body).toHaveFocus();
    fireEvent.keyDown(body, { key: "Enter" });
    await waitFor(() => expect(native.nativeOwnsKeyboard()).toBe(true));
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
  });

  it("[overhaul-730] retains the engaged native viewer and input when its temporary terminal identity becomes durable", async () => {
    useClientStore.setState({ sidebarVisible: false });
    const temporaryId = useTerminalStore.getState().openSession({
      taskId: "story-a", projectId: "project-1", moduleId: "module-1", agent: "codex",
    });
    render(workspace());
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await native.launches.deliver("story-a", "run-native-rekey");
    await waitFor(() => expect(native.nativeOwnsKeyboard()).toBe(true));
    const host = screen.getByTestId("native-terminal-host");
    await act(async () => ackTerminal(temporaryId, "terminal-native-durable", "run-native-rekey"));
    await waitFor(() => expect(useTerminalStore.getState().sessionByRun).toEqual({
      "run-native-rekey": "terminal-native-durable",
    }));
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual(["terminal-native-durable"]);
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("native-terminal-host")).toBe(host);
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
    expect(native.nativeOwnsKeyboard()).toBe(true);
    expect(native.calls("native_terminal_attach")).toEqual([
      ["native_terminal_attach", expect.objectContaining({ runId: "run-native-rekey" })],
    ]);
    expect(native.calls("native_terminal_detach")).toHaveLength(0);
    expect(native.calls("viewer_attach")).toHaveLength(0);
  });

  it("[overhaul-731] keeps fallback terminal selection in navigation mode until Enter engages its input", async () => {
    seedWorkspaceNativeRun("run-fallback-navigation");
    native.failAttachment();
    useClientStore.setState({ sidebarVisible: false, editViewZone: "tab-strip", navigationModality: "keyboard" });
    render(<KeyboardWorkspace />);
    await screen.findByRole("tab", { name: "codex terminal" });
    const strip = screen.getByRole("tablist", { name: "Workspace tabs" });
    strip.focus();
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    fireEvent.keyDown(strip, { key: "Enter" });
    const input = await screen.findByRole("textbox", { name: "Terminal input" });
    expect(input).not.toHaveFocus();
    const body = document.querySelector('[data-navigation-zone="active-tab-body"]')!;
    expect(body).toHaveFocus();
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    fireEvent.keyDown(body, { key: "Enter" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
  });

  it("[overhaul-732] drops delayed native ownership focus after Cmd+Esc disengages the still-presented terminal", async () => {
    seedWorkspaceNativeRun("run-native-disengaged");
    useClientStore.setState({ sidebarVisible: false });
    native.delayOwnership();
    render(<KeyboardWorkspace />);
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await waitFor(() => expect(native.hasPendingOwnership()).toBe(true));
    fireEvent.keyDown(window, { key: "Escape", metaKey: true });
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    const body = document.querySelector('[data-navigation-zone="active-tab-body"]')!;
    expect(body).toHaveFocus();
    await act(async () => native.finishOwnership());
    expect(native.calls("native_terminal_focus")).toHaveLength(0);
    expect(body).toHaveFocus();
    expect(screen.getByTestId("native-terminal-host")).toHaveAttribute("data-native-terminal-presented");
    fireEvent.keyDown(body, { key: "Enter" });
    await waitFor(() => expect(native.nativeOwnsKeyboard()).toBe(true));
    expect(native.calls("native_terminal_attach")).toHaveLength(1);
    expect(useTerminalStore.getState().sessionByRun).toEqual({
      "run-native-disengaged": "session-run-native-disengaged",
    });
  });

  it("[overhaul-733] protects a newly focused editor from delayed native input ownership completion", async () => {
    seedWorkspaceNativeRun("run-native-editor");
    useClientStore.setState({ sidebarVisible: false });
    native.delayOwnership();
    render(<><input aria-label="Other editor" /><KeyboardWorkspace /></>);
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await waitFor(() => expect(native.hasPendingOwnership()).toBe(true));
    const editor = screen.getByRole("textbox", { name: "Other editor" });
    editor.focus();
    await act(async () => native.finishOwnership());
    expect(editor).toHaveFocus();
    expect(native.calls("native_terminal_focus")).toHaveLength(0);
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(native.calls("native_terminal_attach")).toHaveLength(1);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-native-editor": "session-run-native-editor" });
  });

  it("[overhaul-734] drops stale first-press fallback focus when native failure arrives after Cmd+Esc", async () => {
    seedWorkspaceNativeRun("run-delayed-fallback");
    useClientStore.setState({ sidebarVisible: false });
    native.delayAttachment();
    native.failAttachment();
    render(<KeyboardWorkspace />);
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await waitFor(() => expect(native.hasPendingAttachment()).toBe(true));
    fireEvent.keyDown(window, { key: "Escape", metaKey: true });
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    await act(async () => native.finishAttachment());
    const input = await screen.findByRole("textbox", { name: "Terminal input" });
    const body = document.querySelector('[data-navigation-zone="active-tab-body"]')!;
    expect(body).toHaveFocus();
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(body, { key: "Enter" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(native.calls("viewer_attach")).toEqual([
      ["viewer_attach", expect.objectContaining({ runId: "run-delayed-fallback" })],
    ]);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-delayed-fallback": "session-run-delayed-fallback" });
  });

  it.each(["native", "fallback"])("[overhaul-735] restores authorized full-sidebar %s input after conversation configuration returns the same retained workspace", async (renderer) => {
    const runId = `run-sidebar-return-${renderer}`;
    const session = seedWorkspaceNativeRun(runId);
    if (renderer === "fallback") native.failAttachment();
    const view = render(workspace(true, runId));
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    const input = renderer === "fallback"
      ? await screen.findByRole("textbox", { name: "Terminal input" }) : null;
    await waitFor(() => expect(input ? document.activeElement === input : native.nativeOwnsKeyboard()).toBe(true));
    const focusCount = native.calls("native_terminal_focus").length;
    await act(async () => useClientStore.getState().toggleConversationConfiguration("project-1", "module-1"));
    view.rerender(workspace(false, runId));
    const other = screen.getByRole("button", { name: "Other control" });
    other.focus();
    expect(other).toHaveFocus();
    await act(async () => useClientStore.getState().dismissConversationConfiguration());
    view.rerender(workspace(true, runId));
    await waitFor(() => expect(input ? document.activeElement === input : native.calls("native_terminal_focus").length > focusCount).toBe(true));
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(useClientStore.getState().sidebarVisible).toBe(true);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ [runId]: session.sessionId });
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual([session.sessionId]);
    expect(native.calls(renderer === "native" ? "native_terminal_attach" : "viewer_attach")).toHaveLength(1);
    expect(native.calls("native_terminal_detach")).toHaveLength(0);
  });
});
