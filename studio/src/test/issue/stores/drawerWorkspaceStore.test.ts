import { describe, it, expect, beforeEach } from "vitest";
import { useIssueDrawerWorkspaceStore } from "../../../features/work-items/issue-detail";
import type { DesignDoc } from "../../../features/agents/types";

const doc = (id: string, relPath: string): DesignDoc => ({
  id,
  rel_path: relPath,
  label: relPath.split("/").pop()?.replace(/\.html$/, "") ?? relPath,
});

const ws = (bucket = "t1") => useIssueDrawerWorkspaceStore.getState().workspaces[bucket];

describe("drawerWorkspaceStore workspace slice", () => {
  beforeEach(() => {
    useIssueDrawerWorkspaceStore.setState({ workspaces: {} });
  });

  it("ensureWorkspace seeds defaults: Details active, no docs, no history, no overlays", () => {
    useIssueDrawerWorkspaceStore.getState().ensureWorkspace("t1");
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
    useIssueDrawerWorkspaceStore.getState().ensureWorkspace("t1");
    expect(ws().overlayOpenByDoc["d1"]).toBeUndefined();
    useIssueDrawerWorkspaceStore.getState().setOverlayOpen("t1", "d1", true);
    expect(ws().overlayOpenByDoc["d1"]).toBe(true);
    useIssueDrawerWorkspaceStore.getState().setOverlayOpen("t1", "d1", false);
    expect(ws().overlayOpenByDoc["d1"]).toBeUndefined();
  });

  it("each document's overlay flag is independent", () => {
    useIssueDrawerWorkspaceStore.getState().ensureWorkspace("t1");
    useIssueDrawerWorkspaceStore.getState().setOverlayOpen("t1", "d1", true);
    useIssueDrawerWorkspaceStore.getState().setOverlayOpen("t1", "d2", true);
    expect(ws().overlayOpenByDoc).toEqual({ d1: true, d2: true });
    useIssueDrawerWorkspaceStore.getState().setOverlayOpen("t1", "d1", false);
    // Closing d1's overlay leaves d2's open.
    expect(ws().overlayOpenByDoc).toEqual({ d2: true });
  });

  it("closing a doc dismisses its own overlay flag", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().setOverlayOpen("t1", "d1", true);
    useIssueDrawerWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().active).toBe("details");
    expect(ws().overlayOpenByDoc["d1"]).toBeUndefined();
  });

  it("closing one doc leaves another doc's open overlay intact", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "a.html"), "created");
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d2", "b.html"), "created");
    useIssueDrawerWorkspaceStore.getState().setOverlayOpen("t1", "d2", true);
    useIssueDrawerWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().overlayOpenByDoc["d2"]).toBe(true);
  });

  it("ensureWorkspace does not clobber an existing workspace", () => {
    useIssueDrawerWorkspaceStore.getState().ensureWorkspace("t1");
    useIssueDrawerWorkspaceStore.getState().setActive("t1", "terminal");
    useIssueDrawerWorkspaceStore.getState().ensureWorkspace("t1");
    expect(ws().active).toBe("terminal");
  });

  // ---------- discovered documents (#521) ----------

  it("a created doc opens a tab and becomes active immediately", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
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
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().setActive("t1", "terminal");

    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "updated");

    expect(ws().docs).toHaveLength(1);
    expect(ws().docs[0].reloadToken).toBe(1);
    expect(ws().active).toBe("terminal");
  });

  it("a duplicate created frame for a known path never duplicates the tab", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().setActive("t1", "details");

    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d9", "design.html"), "created");

    expect(ws().docs).toHaveLength(1);
    expect(ws().docs[0].reloadToken).toBe(1);
    // A reload of a known path is treated as an update: no focus steal.
    expect(ws().active).toBe("details");
  });

  it("an update for an unseen path surfaces a tab silently", () => {
    useIssueDrawerWorkspaceStore.getState().ensureWorkspace("t1");
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "late.html"), "updated");
    expect(ws().docs).toHaveLength(1);
    expect(ws().active).toBe("details");
  });

  it("multiple documents coexist as independent tabs", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "overview.html"), "created");
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d2", "api.html"), "created");
    expect(ws().docs.map((d) => d.docId)).toEqual(["d1", "d2"]);
    // The newest creation took focus.
    expect(ws().activeDocId).toBe("d2");
  });

  it("duplicate stems are disambiguated with the parent folder", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "a/design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d2", "b/design.html"), "created");
    expect(ws().docs.map((d) => d.label)).toEqual(["a/design", "b/design"]);
  });

  // ---------- restore ----------

  it("hydrateDocs restores tabs silently and merges known state", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "updated");
    useIssueDrawerWorkspaceStore.getState().setActive("t1", "details");

    useIssueDrawerWorkspaceStore
      .getState()
      .hydrateDocs("t1", [doc("d1", "design.html"), doc("d2", "api.html")]);

    expect(ws().docs.map((d) => d.relPath)).toEqual(["design.html", "api.html"]);
    // Known tab kept its reload state; nothing was activated.
    expect(ws().docs[0].reloadToken).toBe(1);
    expect(ws().active).toBe("details");
  });

  it("hydrateDocs drops tabs the registry no longer lists", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "gone.html"), "created");
    useIssueDrawerWorkspaceStore.getState().hydrateDocs("t1", [doc("d2", "kept.html")]);
    expect(ws().docs.map((d) => d.relPath)).toEqual(["kept.html"]);
    // The active doc vanished: fall back to Details.
    expect(ws().active).toBe("details");
    expect(ws().activeDocId).toBeNull();
  });

  // ---------- close / reopen ----------

  it("closeDoc demotes the doc and falls back to Details when it was active", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().docs[0].open).toBe(false);
    expect(ws().active).toBe("details");
    expect(ws().activeDocId).toBeNull();
  });

  it("closeDoc keeps a non-doc active tab unchanged", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().setActive("t1", "terminal");
    useIssueDrawerWorkspaceStore.getState().closeDoc("t1", "d1");
    expect(ws().active).toBe("terminal");
  });

  it("reopenDoc reopens the doc and makes it active", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "design.html"), "created");
    useIssueDrawerWorkspaceStore.getState().closeDoc("t1", "d1");
    useIssueDrawerWorkspaceStore.getState().reopenDoc("t1", "d1");
    expect(ws().docs[0].open).toBe(true);
    expect(ws().active).toBe("doc");
    expect(ws().activeDocId).toBe("d1");
  });

  it("setActiveDoc switches between open docs", () => {
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d1", "a.html"), "created");
    useIssueDrawerWorkspaceStore.getState().upsertDoc("t1", doc("d2", "b.html"), "created");
    useIssueDrawerWorkspaceStore.getState().setActiveDoc("t1", "d1");
    expect(ws().activeDocId).toBe("d1");
    expect(ws().active).toBe("doc");
  });

  // ---------- history chips ----------

  it("recordClosedRun appends inert history chips", () => {
    useIssueDrawerWorkspaceStore
      .getState()
      .recordClosedRun("t1", { agentRunId: "run-1", agent: "claude", label: "#12 · claude" });
    useIssueDrawerWorkspaceStore
      .getState()
      .recordClosedRun("t1", { agentRunId: null, agent: "codex", label: "plan" });
    const history = ws().history;
    expect(history).toHaveLength(2);
    expect(history[0].label).toBe("#12 · claude");
    expect(history[1].agentRunId).toBeNull();
  });
});
