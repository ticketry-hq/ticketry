import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { TaskWorkspace } from "../features/task-workspace";
import { useClientStore } from "../state/clientStore";
import { installDeferredWorkspaceDocuments, workspaceDocument } from "./renderedTaskWorkspaceDocumentFixture";
import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";

function KeymapHarness() {
  useGlobalKeymap();
  return null;
}

function pressCommandArrow(key: "ArrowLeft" | "ArrowRight"): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, metaKey: true });
}

describe("overhaul acceptance — Command-arrow workspace tab navigation", () => {
  let documents: ReturnType<typeof installDeferredWorkspaceDocuments>;
  beforeEach(() => {
    installWorkspaceViewerTransport();
    documents = installDeferredWorkspaceDocuments();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("# Design notes", { headers: { ETag: '"revision-1"' } })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("[overhaul-832] lands an engaged Command-arrow arrival on a document in navigation mode so the next Command-arrow leaves it", async () => {
    useClientStore.setState({ sidebarVisible: false, editViewBodyEngaged: true, editViewZone: "active-tab-body" });
    render(<><KeymapHarness /><TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Story A details</div>} /></>);
    await documents.deliver("story-a", [workspaceDocument("markdown-a", "DESIGN.md")]);
    const details = await screen.findByRole("tab", { name: "Details" });
    await waitFor(() => expect(screen.getByTestId("workspace-details-surface")).toHaveFocus());

    pressCommandArrow("ArrowRight");
    const design = screen.getByRole("tab", { name: "DESIGN" });
    expect(design).toHaveAttribute("aria-selected", "true");
    const content = await screen.findByRole("textbox", { name: "editable markdown" }, { timeout: 30_000 });
    await act(async () => {});
    expect(content).not.toHaveFocus();
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);

    pressCommandArrow("ArrowLeft");
    expect(details).toHaveAttribute("aria-selected", "true");
  }, 60_000);
});
