import { describe, it, expect, beforeEach } from "vitest";
import { useTicketWorkspaceStore } from "../app/shell/ticket-workspace/selected-ticket";
import type { DesignDoc } from "../features/agents/types";

const doc = (id: string, relPath: string): DesignDoc => ({
  id,
  rel_path: relPath,
  label: relPath.split("/").pop()?.replace(/\.html$/, "") ?? relPath,
});

const ws = (bucket = "t1") => useTicketWorkspaceStore.getState().workspaces[bucket];

describe("ticketWorkspaceStore", () => {
  beforeEach(() => {
    useTicketWorkspaceStore.setState({ workspaces: {} });
  });

  it("ensureWorkspace seeds defaults: Details active, no docs, no history, no overlays", () => {
    useTicketWorkspaceStore.getState().ensureWorkspace("t1");
    expect(ws()).toEqual({
      active: "details",
      activeDocId: null,
      docs: [],
      history: [],
      overlayOpenByDoc: {},
    });
  });

  // ---------- doc-agent overlay (#625) ----------

  it("setOverlayOpen toggles a per-document overlay flag", () => {
    useTicketWorkspaceStore.getState().ensureWorkspace("t1");
    expect(ws().overlayOpenByDoc["d1"]).toBeUndefined();
    useTicketWorkspaceStore.getState().setOverlayOpen("t1", "d1", true);
    expect(ws().overlayOpenByDoc["d1"]).toBe(true);
    useTicketWorkspaceStore.getState().setOverlayOpen("t1", "d1", false);
    expect(ws().overlayOpenByDoc["d1"]).toBeUndefined();
  });

  it("each document's overlay flag is independent", () => {
    useTicketWorkspaceStore.getState().ensureWorkspace("t1");
    useTicketWorkspaceStore.getState().setOverlayOpen("t1", "d1", true);
    useTicketWorkspaceStore.getState().setOverlayOpen("t1", "d2", true);
    expect(ws().overlayOpenByDoc).toEqual({ d1: true, d2: true });
    useTicketWorkspaceStore.getState().setOverlayOpen("t1", "d1", false);
    // Closing d1's overlay leaves d2's open.
    expect(ws().overlayOpenByDoc).toEqual({ d2: true });
  });

  it("closing a doc dismisses its own overlay flag", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useTicketWorkspaceStore.getState().setOverlayOpen("t1", "d1", true);
    useTicketWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().active).toBe("doc");
    expect(ws().overlayOpenByDoc["d1"]).toBeUndefined();
  });

  it("closing one doc leaves another doc's open overlay intact", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "a.html"), "created");
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d2", "b.html"), "created");
    useTicketWorkspaceStore.getState().setOverlayOpen("t1", "d2", true);
    useTicketWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().overlayOpenByDoc["d2"]).toBe(true);
  });

  it("ensureWorkspace does not clobber an existing workspace", () => {
    useTicketWorkspaceStore.getState().ensureWorkspace("t1");
    useTicketWorkspaceStore.getState().setActive("t1", "terminal");
    useTicketWorkspaceStore.getState().ensureWorkspace("t1");
    expect(ws().active).toBe("terminal");
  });

  // ---------- discovered documents (#521) ----------

  it("a created doc opens a tab and becomes active immediately", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    expect(ws().docs).toHaveLength(1);
    expect(ws().docs[0]).toMatchObject({
      docId: "d1",
      relPath: "design.html",
      label: "design",
      open: true,
      reloadToken: 0,
    });
    expect(ws().active).toBe("doc");
    expect(ws().activeDocId).toBe("d1");
  });

  it("an update reloads the existing tab without stealing focus", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useTicketWorkspaceStore.getState().setActive("t1", "terminal");

    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "updated");

    expect(ws().docs).toHaveLength(1);
    expect(ws().docs[0].reloadToken).toBe(1);
    expect(ws().active).toBe("terminal");
  });

  it("a duplicate created frame for a known path never duplicates the tab", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useTicketWorkspaceStore.getState().setActive("t1", "details");

    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d9", "design.html"), "created");

    expect(ws().docs).toHaveLength(1);
    expect(ws().docs[0].reloadToken).toBe(1);
    // A reload of a known path is treated as an update: no focus steal.
    expect(ws().active).toBe("details");
  });

  it("an update for an unseen path surfaces a tab silently", () => {
    useTicketWorkspaceStore.getState().ensureWorkspace("t1");
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "late.html"), "updated");
    expect(ws().docs).toHaveLength(1);
    expect(ws().active).toBe("details");
  });

  it("multiple documents coexist as independent tabs", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "overview.html"), "created");
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d2", "api.html"), "created");
    expect(ws().docs.map((d) => d.docId)).toEqual(["d1", "d2"]);
    // The newest creation took focus.
    expect(ws().activeDocId).toBe("d2");
  });

  it("duplicate stems are disambiguated with the parent folder", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "a/design.html"), "created");
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d2", "b/design.html"), "created");
    expect(ws().docs.map((d) => d.label)).toEqual(["a/design", "b/design"]);
  });

  // ---------- restore ----------

  it("hydrateDocs restores tabs silently and merges known state", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "updated");
    useTicketWorkspaceStore.getState().setActive("t1", "details");

    useTicketWorkspaceStore
      .getState()
      .hydrateDocs("t1", [doc("d1", "design.html"), doc("d2", "api.html")]);

    expect(ws().docs.map((d) => d.relPath)).toEqual(["design.html", "api.html"]);
    // Known tab kept its reload state; nothing was activated.
    expect(ws().docs[0].reloadToken).toBe(1);
    expect(ws().active).toBe("details");
  });

  it("hydrateDocs drops missing tabs without overwriting selection intent", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "gone.html"), "created");
    useTicketWorkspaceStore.getState().hydrateDocs("t1", [doc("d2", "kept.html")]);
    expect(ws().docs.map((d) => d.relPath)).toEqual(["kept.html"]);
    expect(ws().active).toBe("doc");
    expect(ws().activeDocId).toBe("d1");
  });

  // ---------- close / reopen ----------

  it("closeDoc preserves the selected document intent", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useTicketWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().docs[0].open).toBe(false);
    expect(ws().active).toBe("doc");
    expect(ws().activeDocId).toBe("d1");
  });

  it("closeDoc keeps a non-doc active tab unchanged", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useTicketWorkspaceStore.getState().setActive("t1", "terminal");
    useTicketWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().active).toBe("terminal");
  });

  it("reopenDoc reopens the doc and makes it active", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useTicketWorkspaceStore.getState().closeDoc("t1", "d1");
    useTicketWorkspaceStore.getState().reopenDoc("t1", "d1");
    expect(ws().docs[0].open).toBe(true);
    expect(ws().active).toBe("doc");
    expect(ws().activeDocId).toBe("d1");
  });

  it("setActiveDoc switches between open docs", () => {
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d1", "a.html"), "created");
    useTicketWorkspaceStore.getState().upsertDoc("t1", doc("d2", "b.html"), "created");
    useTicketWorkspaceStore.getState().setActiveDoc("t1", "d1");
    expect(ws().activeDocId).toBe("d1");
    expect(ws().active).toBe("doc");
  });

  // ---------- history chips ----------

  it("recordClosedRun appends inert history chips", () => {
    useTicketWorkspaceStore
      .getState()
      .recordClosedRun("t1", { agentRunId: "run-1", agent: "claude", label: "#12 · claude" });
    useTicketWorkspaceStore
      .getState()
      .recordClosedRun("t1", { agentRunId: null, agent: "codex", label: "plan" });
    const history = ws().history;
    expect(history).toHaveLength(2);
    expect(history[0].label).toBe("#12 · claude");
    expect(history[1].agentRunId).toBeNull();
  });
});
