import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { readStudioWorkspaceTarget, rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { installDeferredWorkspaceDocuments, workspaceDocument } from "./renderedTaskWorkspaceDocumentFixture";
import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";

describe("overhaul acceptance — document restoration respects workspace intent", () => {
  let documents: ReturnType<typeof installDeferredWorkspaceDocuments>;
  beforeEach(() => {
    installWorkspaceViewerTransport();
    documents = installDeferredWorkspaceDocuments();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("[overhaul-674] preserves a remembered document when the authoritative document refresh fails", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.fail("story-a");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Story A details")).toBeVisible();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });

  it("[overhaul-675] keeps explicit Details entry selected when a remembered document arrives later", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    const { rerender } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    rerender(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" entrySignal={1} details={<div>Story A details</div>} />);
    await documents.deliver("story-a", [workspaceDocument()]);
    expect(await screen.findByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Story A details")).toBeVisible();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
  });

  it("[overhaul-676] preserves the current document after an old A response completes following A to B to A", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    const { rerender } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    rerender(<TaskWorkspace bucket="story-b" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story B details</div>} />);
    await documents.request("story-b");
    rerender(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.deliver("story-a", [workspaceDocument("design-current")], 1);
    await waitFor(() => expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByTitle("DESIGN")).toHaveAttribute("src", expect.stringContaining("design-current"));
    await documents.deliver("story-a", [workspaceDocument("design-obsolete")]);
    expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTitle("DESIGN")).toHaveAttribute("src", expect.stringContaining("design-current"));
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });

  it("[overhaul-677] keeps a remembered path during loading and restores its authoritative document identity", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    expect(screen.getByText("Story A details")).toBeVisible();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
    await documents.deliver("story-a", [workspaceDocument("design-authoritative")]);
    await waitFor(() => expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByTitle("DESIGN")).toHaveAttribute("src", expect.stringContaining("design-authoritative"));
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });

  it("[overhaul-678] repairs remembered state to Details only after a successful read proves the document missing", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "MISSING.html" });
    render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "MISSING.html" });
    await documents.deliver("story-a", [workspaceDocument()]);
    expect(await screen.findByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Story A details")).toBeVisible();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
  });

  it("[overhaul-679] honors an explicit Details tab selection through unrelated presentation updates during hydration", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    const { rerender } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    rerender(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" conversationTitle="Updated conversation title" details={<div>Updated story details</div>} />);
    await documents.deliver("story-a", [workspaceDocument()]);
    expect(await screen.findByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Updated story details")).toBeVisible();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
  });

  it("[overhaul-680] ignores an old document completion after A to B without changing either remembered target", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    rememberStudioWorkspaceTarget("story-b", { kind: "details" });
    const { rerender } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    rerender(<TaskWorkspace bucket="story-b" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story B details</div>} />);
    await documents.deliver("story-b", [workspaceDocument("design-b", "NOTES.html")]);
    await documents.deliver("story-a", []);
    expect(screen.getByText("Story B details")).toBeVisible();
    expect(screen.getByRole("tab", { name: "NOTES" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("tab", { name: "DESIGN" })).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
    expect(readStudioWorkspaceTarget("story-b")).toEqual({ kind: "details" });
  });

  it("[overhaul-681] leaves remembered intent intact when a document response finishes after workspace disposal", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    const { unmount } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    unmount();
    await documents.deliver("story-a", []);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });

  it("[overhaul-682] restores the current module context within one bucket while ignoring the former context response", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    const { rerender } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Original module details</div>} />);
    await documents.request("story-a");
    rerender(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-2"
      owner="studio" details={<div>Current module details</div>} />);
    await documents.deliver("story-a", [workspaceDocument("design-module-2")], 1);
    await waitFor(() => expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true"));
    await documents.deliver("story-a", []);
    expect(screen.getByTitle("DESIGN")).toBeVisible();
    expect(screen.getByTitle("DESIGN")).toHaveAttribute("src", expect.stringContaining("design-module-2"));
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });

  it("[overhaul-683] keeps an explicitly reopened document selected over pending remembered restoration", async () => {
    const rows = [workspaceDocument(), workspaceDocument("notes-a", "NOTES.html")];
    const { rerender } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.deliver("story-a", rows);
    fireEvent.click(await screen.findByRole("button", { name: "Close NOTES" }));
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    rerender(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-2"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a", 1);
    fireEvent.click(screen.getByRole("button", { name: "Dormant tabs (1)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reopen NOTES" }));
    await documents.deliver("story-a", rows, 1);
    expect(screen.getByRole("tab", { name: "NOTES" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTitle("NOTES")).toBeVisible();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "NOTES.html" });
  });

  it("[overhaul-700] retains the current document fields when an obsolete refresh returns the same document identity", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    const { rerender } = render(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.request("story-a");
    rerender(<TaskWorkspace bucket="story-b" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story B details</div>} />);
    await documents.request("story-b");
    rerender(<TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} />);
    await documents.deliver("story-a", [workspaceDocument("shared-document")], 1);
    await waitFor(() => expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true"));
    const frame = screen.getByTitle("DESIGN");
    await documents.deliver("story-a", [{ ...workspaceDocument("shared-document", "OBSOLETE.html"), contentDigest: "obsolete-digest" }]);
    expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "OBSOLETE" })).not.toBeInTheDocument();
    expect(screen.getByTitle("DESIGN")).toBe(frame);
    expect(frame).toHaveAttribute("src", expect.stringContaining("shared-document/DESIGN.html"));
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });
});
