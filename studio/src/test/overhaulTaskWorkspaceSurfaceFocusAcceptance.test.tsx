import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { useClientStore } from "../state/clientStore";
import { installDeferredWorkspaceDocuments, workspaceDocument } from "./renderedTaskWorkspaceDocumentFixture";
import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";
import NameEditor from "../app/shell/ticket-workspace/selected-ticket/details/NameEditor";
import { useModalStore } from "../shared/modal/modalStore";

describe("overhaul acceptance — rendered workspace surface focus authority", () => {
  let documents: ReturnType<typeof installDeferredWorkspaceDocuments>;
  beforeEach(() => {
    installWorkspaceViewerTransport();
    documents = installDeferredWorkspaceDocuments();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("[overhaul-718] focuses the remembered document on its first authorized hydration while preserving global body engagement", async () => {
    useClientStore.setState({ sidebarVisible: false, editViewBodyEngaged: true, editViewZone: "active-tab-body" });
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.deliver("story-a", [workspaceDocument()]);
    expect(await screen.findByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true");
    const frame = await screen.findByTitle("DESIGN");
    await waitFor(() => expect(frame).toHaveFocus());
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
  });

  it("[overhaul-719] lets document hydration finish under configuration without taking focus and focuses its retained frame on authorized return", async () => {
    useClientStore.setState({ sidebarVisible: false, editViewBodyEngaged: true, editViewZone: "active-tab-body" });
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    render(<><input aria-label="Configuration editor" /><TaskWorkspace bucket="story-a"
      projectId="project-1" moduleId="module-1" owner="studio" details={<div>Story A details</div>} /></>);
    act(() => useClientStore.getState().toggleStateConfiguration("project-1", "state-1"));
    const editor = screen.getByRole("textbox", { name: "Configuration editor" });
    editor.focus();
    await documents.deliver("story-a", [workspaceDocument()]);
    const frame = await screen.findByTitle("DESIGN");
    expect(frame).toBeVisible();
    expect(editor).toHaveFocus();
    editor.blur();
    act(() => useClientStore.getState().dismissStateConfiguration());
    await waitFor(() => expect(frame).toHaveFocus());
    expect(screen.getByTitle("DESIGN")).toBe(frame);
  });

  it("[overhaul-720] leaves Details entry unfocused while retained and restores it only when body engagement authorizes return", async () => {
    useClientStore.setState({ sidebarVisible: false, editViewZone: "active-tab-body" });
    const props = { bucket: "story-a", projectId: "project-1", moduleId: "module-1", owner: "studio" as const,
      details: <div>Story A details</div> };
    const { rerender } = render(<><input aria-label="Foreground editor" /><TaskWorkspace {...props} workspaceActive={false} /></>);
    const editor = screen.getByRole("textbox", { name: "Foreground editor" });
    editor.focus();
    rerender(<><input aria-label="Foreground editor" /><TaskWorkspace {...props} workspaceActive={false} entrySignal={1} /></>);
    await documents.deliver("story-a", []);
    expect(editor).toHaveFocus();
    act(() => useClientStore.setState({ editViewBodyEngaged: false, editViewZone: "stories" }));
    editor.blur();
    rerender(<><input aria-label="Foreground editor" /><TaskWorkspace {...props} entrySignal={1} /></>);
    expect(screen.getByTestId("workspace-details-surface")).not.toHaveFocus();
    act(() => useClientStore.setState({ editViewBodyEngaged: true, editViewZone: "active-tab-body" }));
    await waitFor(() => expect(screen.getByTestId("workspace-details-surface")).toHaveFocus());
  });

  it("[overhaul-721] protects a foreground editor when configuration closes over an engaged document", async () => {
    useClientStore.setState({ sidebarVisible: false, editViewBodyEngaged: true, editViewZone: "active-tab-body" });
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    render(<><input aria-label="Foreground editor" /><TaskWorkspace bucket="story-a"
      projectId="project-1" moduleId="module-1" owner="studio" details={<div>Story A details</div>} /></>);
    await documents.deliver("story-a", [workspaceDocument()]);
    await waitFor(() => expect(screen.getByTitle("DESIGN")).toHaveFocus());
    act(() => useClientStore.getState().toggleStateConfiguration("project-1", "state-1"));
    const editor = screen.getByRole("textbox", { name: "Foreground editor" });
    editor.focus();
    act(() => useClientStore.getState().dismissStateConfiguration());
    expect(editor).toHaveFocus();
    expect(screen.getByTitle("DESIGN")).not.toHaveFocus();
  });

  it("[overhaul-722] carries first engagement into the Markdown editor after its document bytes hydrate", async () => {
    let finishContent: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finishContent = resolve; })));
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.deliver("story-a", [workspaceDocument("markdown-a", "DESIGN.md")]);
    fireEvent.click(await screen.findByRole("tab", { name: "DESIGN" }));
    await waitFor(() => expect(finishContent).toBeDefined());
    await act(async () => finishContent?.(new Response("# Remembered design", { headers: { ETag: '"revision-1"' } })));
    const content = await screen.findByRole("textbox", { name: "editable markdown" }, { timeout: 10_000 });
    await waitFor(() => expect(content).toHaveFocus());
  });

  it("[overhaul-723] hydrates a retained Markdown editor without focusing it after a newer Details selection", async () => {
    let finishContent: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finishContent = resolve; })));
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.deliver("story-a", [workspaceDocument("markdown-a", "DESIGN.md")]);
    fireEvent.click(await screen.findByRole("tab", { name: "DESIGN" }));
    await waitFor(() => expect(finishContent).toBeDefined());
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    const details = screen.getByTestId("workspace-details-surface");
    await waitFor(() => expect(details).toHaveFocus());
    await act(async () => finishContent?.(new Response("# Remembered design", { headers: { ETag: '"revision-1"' } })));
    const content = await screen.findByRole("textbox", { name: "editable markdown", hidden: true }, { timeout: 10_000 });
    expect(content).not.toHaveFocus();
    expect(details).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  });

  it("[overhaul-822] keeps the Name editor focused after its single-click entry engages the Details surface", async () => {
    useClientStore.setState({ sidebarVisible: false, editViewBodyEngaged: false, editViewZone: "active-tab-body" });
    const onSave = vi.fn();
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1" owner="studio"
      details={<NameEditor name="Story A" saving={false} onSave={onSave} />} />);
    await documents.deliver("story-a", []);
    const heading = await screen.findByTestId("issue-name");
    // A real click delivers mousedown and click before the engagement's
    // passive focus effect runs, so both land in one React batch.
    act(() => {
      heading.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      heading.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = screen.getByRole("textbox", { name: "Name" });
    await act(async () => {});
    expect(input).toHaveFocus();
    expect(screen.getByTestId("workspace-details-surface")).not.toHaveFocus();
    fireEvent.change(input, { target: { value: "Story A renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("Story A renamed");
  });

  it("[overhaul-824] keeps a Details control focused when a modal it opened closes over the engaged surface", async () => {
    useClientStore.setState({ sidebarVisible: false, editViewBodyEngaged: true, editViewZone: "active-tab-body" });
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1" owner="studio"
      details={<button type="button">Story workflow guide</button>} />);
    await documents.deliver("story-a", []);
    const trigger = screen.getByRole("button", { name: "Story workflow guide" });
    act(() => {
      trigger.focus();
      useModalStore.getState().pushModal({ type: "story-workflow-guide", payload: { storyId: "story-a" } });
    });
    act(() => {
      useModalStore.getState().popModal();
      trigger.focus();
    });
    await act(async () => {});
    expect(trigger).toHaveFocus();
    expect(screen.getByTestId("workspace-details-surface")).not.toHaveFocus();
  });
});
