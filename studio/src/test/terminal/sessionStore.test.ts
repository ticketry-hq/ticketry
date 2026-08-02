import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  docChatKey,
  scratchBucketId,
  selectScratchAgentCount,
  useTerminalStore,
} from "../../features/agents/terminal/internal/sessionStore";
import { useWorkspaceTabsStore } from "../../features/agents/terminal/internal/workspaceTabsStore";
import * as api from "../../features/agents/api/agentApi";
import {
  SCRATCH_RUN_TASK_ID,
  TEMP_TASK_ID,
  type PersistedTerminalSession,
  type ResumableTerminalSession,
} from "../../features/agents/types";
import {
  resolveOwner,
  useTerminalForegroundStore,
} from "../../features/agents/terminal/internal/foregroundStore";

// jsdom does not always expose localStorage here; install a tiny in-memory
// shim so the live-set persistence paths are exercised deterministically.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

const LIVE_RUNS_KEY = "muxed:live-agent-runs:v1";

// Tab/doc-chat indexes moved to the workspace-tabs store (CODIN-981).
function tabs() {
  return useWorkspaceTabsStore.getState();
}

function liveRuns(): string[] {
  const raw = localStorage.getItem(LIVE_RUNS_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

function setLiveRuns(ids: string[]): void {
  localStorage.setItem(LIVE_RUNS_KEY, JSON.stringify(ids));
}

function makePersisted(
  overrides: Partial<PersistedTerminalSession> = {},
): PersistedTerminalSession {
  return {
    agent_run_id: "run-1",
    tmux_session_name: "pt-run-1",
    task_id: "task-1",
    module_id: "mod-1",
    project_id: "proj-1",
    agent: "claude",
    scope: "task",
    created_at: "2026-05-29T00:00:00Z",
    terminated_at: null,
    ...overrides,
  };
}

describe("terminalStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTerminalStore.setState({
      sessions: {},
      sessionByRun: {},
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {}, chatByDoc: {} });
    vi.spyOn(api, "listResumableTerminals").mockResolvedValue([]);
  });

  it("openSession adds a connecting tab and indexes it by bucket", () => {
    const id = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "proj-1",
      agent: "claude",
      ticketSeq: 12,
    });
    const s = useTerminalStore.getState();
    expect(s.sessions[id]).toMatchObject({
      status: "connecting",
      taskId: "task-1",
      projectId: "proj-1",
      agent: "claude",
    });
    expect(tabs().byTaskId["task-1"]).toEqual([id]);
    expect(tabs().activeByTask["task-1"]).toBe(id);
  });

  it("openSession appends multiple terminals to the same bucket", () => {
    const a = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    const b = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "codex",
      ticketSeq: null,
    });
    expect(tabs().byTaskId["task-1"]).toEqual([a, b]);
    // The most recently opened becomes the bucket's active terminal.
    expect(tabs().activeByTask["task-1"]).toBe(b);
  });

  it("no-task sessions bucket under their module's scratch bucket", () => {
    const id = useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      moduleId: "mod-1",
      agent: "claude",
      ticketSeq: null,
      isPlanning: true,
    });
    expect(tabs().byTaskId[scratchBucketId("mod-1")]).toEqual([id]);
    expect(tabs().activeByTask[scratchBucketId("mod-1")]).toBe(id);
  });

  it("two modules' scratch sessions never share a bucket (CODIN-984)", () => {
    const a = useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      moduleId: "mod-1",
      agent: "claude",
      ticketSeq: null,
      isInstant: true,
    });
    const b = useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      moduleId: "mod-2",
      agent: "claude",
      ticketSeq: null,
      isInstant: true,
    });
    expect(tabs().byTaskId[scratchBucketId("mod-1")]).toEqual([a]);
    expect(tabs().byTaskId[scratchBucketId("mod-2")]).toEqual([b]);
    expect(tabs().activeByTask[scratchBucketId("mod-1")]).toBe(a);
    expect(tabs().activeByTask[scratchBucketId("mod-2")]).toBe(b);
  });

  it("setReady rekeys inside the bucket array and activeByTask", () => {
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "server-abc");
    const s = useTerminalStore.getState();
    expect(s.sessions[tempId]).toBeUndefined();
    expect(s.sessions["server-abc"]).toMatchObject({
      status: "ready",
      sessionId: "server-abc",
    });
    expect(tabs().byTaskId["task-1"]).toEqual(["server-abc"]);
    expect(tabs().activeByTask["task-1"]).toBe("server-abc");
  });

  // ---------- doc-agent overlay / doc-chat session (#625) ----------

  it("openDocChat adds to sessions + chatByDoc but not byTaskId/activeByTask", () => {
    const id = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "proj-1",
      moduleId: "mod-1",
      agent: "claude",
      ticketSeq: 7,
      docRelPath: "spec/x/design.html",
    });
    const s = useTerminalStore.getState();
    expect(s.sessions[id]).toMatchObject({
      status: "connecting",
      taskId: "task-1",
      isDocChat: true,
      docRelPath: "spec/x/design.html",
    });
    // The sole index, keyed per document — never a tab, never the ticket's run.
    expect(tabs().chatByDoc[docChatKey("task-1", "spec/x/design.html")]).toBe(id);
    expect(tabs().byTaskId["task-1"]).toBeUndefined();
    expect(tabs().activeByTask["task-1"]).toBeUndefined();
  });

  it("every document in a ticket gets its own independent doc-chat run", () => {
    const a = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "HLD.html",
    });
    const b = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "LLD.html",
    });
    // Two distinct runs, one per document — not deduped to a single per-ticket run.
    expect(a).not.toBe(b);
    const s = useTerminalStore.getState();
    expect(tabs().chatByDoc[docChatKey("task-1", "HLD.html")]).toBe(a);
    expect(tabs().chatByDoc[docChatKey("task-1", "LLD.html")]).toBe(b);
    expect(Object.keys(s.sessions)).toHaveLength(2);
  });

  it("setReady rekeys chatByDoc on the temp→server id swap", () => {
    const tempId = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "d.html",
    });
    useTerminalStore.getState().setReady(tempId, "server-doc", "run-doc");
    const s = useTerminalStore.getState();
    expect(s.sessions[tempId]).toBeUndefined();
    expect(s.sessions["server-doc"]).toMatchObject({ isDocChat: true });
    // The load-bearing edit: the per-document pointer follows the swap.
    expect(tabs().chatByDoc[docChatKey("task-1", "d.html")]).toBe("server-doc");
    // Still never a tab.
    expect(tabs().byTaskId["task-1"]).toBeUndefined();
  });

  it("openDocChat dedupes a live run for the SAME document instead of forking", () => {
    const first = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "d.html",
    });
    const again = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "codex",
      ticketSeq: null,
      docRelPath: "d.html",
    });
    expect(again).toBe(first);
    expect(Object.keys(useTerminalStore.getState().sessions)).toHaveLength(1);
  });

  it("openDocChat replaces a dead prior run with a fresh spawn", () => {
    const first = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "d.html",
    });
    useTerminalStore.getState().setError(first);
    const again = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "d.html",
    });
    expect(again).not.toBe(first);
    const s = useTerminalStore.getState();
    expect(s.sessions[first]).toBeUndefined();
    expect(tabs().chatByDoc[docChatKey("task-1", "d.html")]).toBe(again);
  });

  it("attachPersisted routes a docchat row to chatByDoc, never a tab", () => {
    const id = useTerminalStore.getState().attachPersisted(
      makePersisted({
        agent_run_id: "doc-run",
        scope: "docchat",
        doc_rel_path: "spec/x/design.html",
      }),
    );
    const s = useTerminalStore.getState();
    expect(s.sessions[id]).toMatchObject({
      isDocChat: true,
      docRelPath: "spec/x/design.html",
      agentRunId: "doc-run",
      taskId: "task-1",
    });
    expect(tabs().chatByDoc[docChatKey("task-1", "spec/x/design.html")]).toBe(id);
    expect(tabs().byTaskId["task-1"]).toBeUndefined();
    expect(tabs().activeByTask["task-1"]).toBeUndefined();
  });

  it("closeTab clears the chatByDoc pointer for a doc-chat session", () => {
    const id = useTerminalStore.getState().openDocChat({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "d.html",
    });
    expect(tabs().chatByDoc[docChatKey("task-1", "d.html")]).toBe(id);
    useTerminalStore.getState().closeTab(id);
    expect(useTerminalStore.getState().sessions[id]).toBeUndefined();
    expect(tabs().chatByDoc[docChatKey("task-1", "d.html")]).toBeUndefined();
  });

  it("setExited flips status", () => {
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1");
    useTerminalStore.getState().setExited("sess-1");
    expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("exited");
  });

  it("focusSession sets the active terminal within the bucket", () => {
    const a = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "codex",
      ticketSeq: null,
    });
    useTerminalStore.getState().focusSession(a);
    expect(tabs().activeByTask["task-1"]).toBe(a);
  });

  it("closeTab repoints active to the last remaining terminal in the bucket", () => {
    const a = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    const b = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "codex",
      ticketSeq: null,
    });
    expect(tabs().activeByTask["task-1"]).toBe(b);
    useTerminalStore.getState().closeTab(b);
    expect(useTerminalStore.getState().sessions[b]).toBeUndefined();
    expect(tabs().byTaskId["task-1"]).toEqual([a]);
    expect(tabs().activeByTask["task-1"]).toBe(a);
  });

  it("closeTab on the last tab in a bucket drops the bucket entries", () => {
    const a = useTerminalStore.getState().openSession({
      taskId: "task-a",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().closeTab(a);
    expect(tabs().byTaskId["task-a"]).toBeUndefined();
    expect(tabs().activeByTask["task-a"]).toBeUndefined();
  });

  it("fetchPersistedSessions stores the list keyed by task", async () => {
    const list = [makePersisted(), makePersisted({ agent_run_id: "run-2" })];
    vi.spyOn(api, "getTerminals").mockResolvedValue(list);
    await useTerminalStore.getState().fetchPersistedSessions("task-1");
    expect(useTerminalStore.getState().persistedSessions["task-1"]).toEqual(list);
    expect(api.listResumableTerminals).toHaveBeenCalledWith("task-1");
  });

  it("fetchPersistedSessions swallows errors and leaves state intact", async () => {
    vi.spyOn(api, "getTerminals").mockRejectedValue(new Error("boom"));
    const outcome =
      await useTerminalStore.getState().fetchPersistedSessions("task-1");
    expect(outcome).toBe("failed");
    expect(useTerminalStore.getState().persistedSessions["task-1"]).toBeUndefined();
  });

  it("fetchPersistedSessions reports when a newer task fetch supersedes it", async () => {
    let resolveFirst!: (list: PersistedTerminalSession[]) => void;
    let resolveSecond!: (list: PersistedTerminalSession[]) => void;
    vi.spyOn(api, "getTerminals")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const first = useTerminalStore.getState().fetchPersistedSessions("task-1");
    const second = useTerminalStore.getState().fetchPersistedSessions("task-1");
    resolveFirst([makePersisted({ agent_run_id: "stale-run" })]);

    await expect(first).resolves.toBe("superseded");
    expect(useTerminalStore.getState().persistedSessions["task-1"]).toBeUndefined();

    resolveSecond([makePersisted({ agent_run_id: "latest-run" })]);
    await expect(second).resolves.toBe("applied");
    expect(
      useTerminalStore.getState().persistedSessions["task-1"]?.[0].agent_run_id,
    ).toBe("latest-run");
  });

  it("does not write a terminal discovery result after its selection aborts", async () => {
    let resolve!: (list: PersistedTerminalSession[]) => void;
    vi.spyOn(api, "getTerminals").mockImplementation(
      () => new Promise((done) => { resolve = done; }),
    );
    const controller = new AbortController();
    const pending = useTerminalStore.getState().fetchPersistedSessions(
      "task-1",
      controller.signal,
    );

    controller.abort();
    resolve([makePersisted({ agent_run_id: "stale-run" })]);

    await expect(pending).resolves.toBe("superseded");
    expect(useTerminalStore.getState().persistedSessions["task-1"]).toBeUndefined();
  });

  it("fetchScratchSessions stores no-task sessions under the scratch bucket", async () => {
    const list = [
      makePersisted({
        agent_run_id: "plan-1",
        task_id: "00000000-0000-0000-0000-000000000000",
        scope: "plan",
      }),
    ];
    vi.spyOn(api, "getScratchTerminals").mockResolvedValue(list);
    await useTerminalStore.getState().fetchScratchSessions("proj-1", "mod-1");
    expect(
      useTerminalStore.getState().persistedSessions[scratchBucketId("mod-1")],
    ).toEqual(list);
  });

  it("module-scoped scratch fetch never clobbers another module's list (CODIN-986)", async () => {
    const modTwo = [
      makePersisted({
        agent_run_id: "plan-2",
        task_id: SCRATCH_RUN_TASK_ID,
        module_id: "mod-2",
        scope: "plan",
      }),
    ];
    vi.spyOn(api, "getScratchTerminals").mockResolvedValueOnce(modTwo);
    await useTerminalStore.getState().fetchScratchSessions("proj-1", "mod-2");

    const modOne = [
      makePersisted({
        agent_run_id: "plan-1",
        task_id: SCRATCH_RUN_TASK_ID,
        module_id: "mod-1",
        scope: "plan",
      }),
    ];
    vi.spyOn(api, "getScratchTerminals").mockResolvedValueOnce(modOne);
    await useTerminalStore.getState().fetchScratchSessions("proj-1", "mod-1");

    const persisted = useTerminalStore.getState().persistedSessions;
    expect(persisted[scratchBucketId("mod-1")]).toEqual(modOne);
    expect(persisted[scratchBucketId("mod-2")]).toEqual(modTwo);
  });

  it("fetchScratchSessions also loads resumable runs for the selected module", async () => {
    const resumable: ResumableTerminalSession[] = [{
      agent_run_id: "plan-ended",
      agent: "claude",
      status: "terminated",
      started_at: "2026-07-01T00:00:00Z",
      ended_at: "2026-07-01T01:00:00Z",
      provider_session_id: "provider-1",
      resumed_from: null,
    }];
    vi.spyOn(api, "getScratchTerminals").mockResolvedValue([]);
    const listResumable = vi
      .spyOn(api, "listResumableTerminals")
      .mockResolvedValue(resumable);

    await useTerminalStore.getState().fetchScratchSessions("proj-1", "mod-1");

    expect(listResumable).toHaveBeenCalledWith(undefined, "proj-1", "mod-1");
    expect(
      useTerminalStore.getState().resumableSessions[`${TEMP_TASK_ID}:proj-1:mod-1`],
    ).toEqual(resumable);
  });

  it("refreshResumable stores resumable rows keyed by task", async () => {
    const list = [
      {
        agent_run_id: "run-1",
        agent: "claude",
        status: "terminated",
        started_at: "2026-05-29T00:00:00Z",
        ended_at: "2026-05-29T01:00:00Z",
        provider_session_id: "ps-1",
        resumed_from: null,
      },
    ];
    vi.spyOn(api, "listResumableTerminals").mockResolvedValue(list as never);
    await useTerminalStore.getState().refreshResumable("task-1");
    expect(useTerminalStore.getState().resumableSessions["task-1"]).toEqual(list);
  });

  it("refreshResumable prefers the task bucket when project context is also supplied", async () => {
    const list = [{ agent_run_id: "run-1" }] as ResumableTerminalSession[];
    const request = vi.spyOn(api, "listResumableTerminals").mockResolvedValue(list);

    await useTerminalStore.getState().refreshResumable("task-1", "proj-1", "mod-1");

    expect(request).toHaveBeenCalledWith("task-1");
    expect(useTerminalStore.getState().resumableSessions["task-1"]).toEqual(list);
    expect(
      useTerminalStore.getState().resumableSessions[`${TEMP_TASK_ID}:proj-1:mod-1`],
    ).toBeUndefined();
  });

  it("refreshResumable ignores an older response for the same key", async () => {
    const older = [{ agent_run_id: "run-old" }] as ResumableTerminalSession[];
    const newer = [{ agent_run_id: "run-new" }] as ResumableTerminalSession[];
    let resolveOlder: (list: ResumableTerminalSession[]) => void = () => {};
    const olderResponse = new Promise<ResumableTerminalSession[]>((resolve) => {
      resolveOlder = resolve;
    });
    vi.spyOn(api, "listResumableTerminals")
      .mockReturnValueOnce(olderResponse)
      .mockResolvedValueOnce(newer);

    const olderRequest = useTerminalStore.getState().refreshResumable("task-1");
    await useTerminalStore.getState().refreshResumable("task-1");
    resolveOlder(older);
    await olderRequest;

    expect(useTerminalStore.getState().resumableSessions["task-1"]).toEqual(newer);
  });

  it("fetchScratchSessions auto-attaches a live scratch session into the scratch bucket", async () => {
    const list = [
      makePersisted({
        agent_run_id: "plan-1",
        task_id: "00000000-0000-0000-0000-000000000000",
        scope: "plan",
      }),
    ];
    vi.spyOn(api, "getScratchTerminals").mockResolvedValue(list);
    await useTerminalStore.getState().fetchScratchSessions("proj-1", "mod-1");
    // A reattached tab appears under the module's scratch bucket, not the sentinel.
    const ids = tabs().byTaskId[scratchBucketId("mod-1")] ?? [];
    expect(ids).toHaveLength(1);
    const meta = useTerminalStore.getState().sessions[ids[0]];
    expect(meta).toMatchObject({
      taskId: null,
      agentRunId: "plan-1",
      isPlanning: true,
      isInstant: false,
    });
  });

  it("hydrates all scratch modules with one request and groups counts by module", async () => {
    const list = [
      makePersisted({
        agent_run_id: "plan-1",
        task_id: SCRATCH_RUN_TASK_ID,
        module_id: "mod-1",
        scope: "plan",
      }),
      makePersisted({
        agent_run_id: "instant-2",
        task_id: SCRATCH_RUN_TASK_ID,
        module_id: "mod-2",
        scope: "instant",
      }),
    ];
    const getScratch = vi.spyOn(api, "getScratchTerminals").mockResolvedValue(list);

    await useTerminalStore.getState().fetchScratchSessions("proj-1");

    expect(getScratch).toHaveBeenCalledOnce();
    expect(getScratch).toHaveBeenCalledWith("proj-1");
    expect(selectScratchAgentCount(useTerminalStore.getState(), "mod-1")).toBe(1);
    expect(selectScratchAgentCount(useTerminalStore.getState(), "mod-2")).toBe(1);
    expect(selectScratchAgentCount(useTerminalStore.getState(), "mod-3")).toBe(0);
    expect(selectScratchAgentCount(useTerminalStore.getState(), "mod-1", "other-project")).toBe(0);
  });

  it("attachPersisted folds scratch rows into the scratch bucket with their scope", () => {
    const id = useTerminalStore.getState().attachPersisted(
      makePersisted({
        agent_run_id: "inst-1",
        task_id: "00000000-0000-0000-0000-000000000000",
        scope: "instant",
      }),
    );
    const meta = useTerminalStore.getState().sessions[id];
    expect(meta).toMatchObject({
      taskId: null,
      agentRunId: "inst-1",
      isPlanning: false,
      isInstant: true,
    });
    // Bucketed under the module's scratch bucket, not the backend sentinel.
    expect(tabs().byTaskId[scratchBucketId("mod-1")]).toContain(id);
  });

  it("attachPersisted opens an attach-mode session carrying agentRunId", () => {
    const id = useTerminalStore.getState().attachPersisted(makePersisted());
    const meta = useTerminalStore.getState().sessions[id];
    expect(meta).toMatchObject({
      status: "connecting",
      taskId: "task-1",
      projectId: "proj-1",
      agent: "claude",
      agentRunId: "run-1",
    });
  });

  it("attachPersisted focuses an existing tab instead of duplicating", () => {
    const first = useTerminalStore.getState().attachPersisted(makePersisted());
    useTerminalStore.getState().focusSession(first);
    // Open another unrelated tab so first is no longer active in its bucket.
    useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    const again = useTerminalStore.getState().attachPersisted(makePersisted());
    expect(again).toBe(first);
    expect(tabs().activeByTask["task-1"]).toBe(first);
    // No third session was created.
    expect(Object.keys(useTerminalStore.getState().sessions)).toHaveLength(2);
  });

  it("attachPersisted reattaches (fresh tab) when the prior tab is dead", () => {
    const first = useTerminalStore.getState().attachPersisted(makePersisted());
    // Simulate the prior attach's socket closing.
    useTerminalStore.getState().setExited(first);
    expect(useTerminalStore.getState().sessions[first].status).toBe("exited");
    const again = useTerminalStore.getState().attachPersisted(makePersisted());
    expect(again).not.toBe(first);
    expect(useTerminalStore.getState().sessions[first]).toBeUndefined();
    expect(useTerminalStore.getState().sessions[again]).toMatchObject({
      status: "connecting",
      agentRunId: "run-1",
    });
  });

  it("terminatePersisted closes the live tab attached to the killed session", async () => {
    vi.spyOn(api, "terminateTerminal").mockResolvedValue({
      agent_run_id: "run-1",
      terminated: true,
    });
    const tabId = useTerminalStore.getState().attachPersisted(makePersisted());
    useTerminalStore.setState({
      persistedSessions: { "task-1": [makePersisted()] },
    });
    await useTerminalStore.getState().terminatePersisted("run-1", "task-1");
    expect(useTerminalStore.getState().sessions[tabId]).toBeUndefined();
    expect(useTerminalStore.getState().persistedSessions["task-1"]).toEqual([]);
  });

  it("terminatePersisted calls the API and drops the row locally", async () => {
    const spy = vi
      .spyOn(api, "terminateTerminal")
      .mockResolvedValue({ agent_run_id: "run-1", terminated: true });
    useTerminalStore.setState({
      persistedSessions: {
        "task-1": [makePersisted(), makePersisted({ agent_run_id: "run-2" })],
      },
    });
    await useTerminalStore.getState().terminatePersisted("run-1", "task-1");
    expect(spy).toHaveBeenCalledWith("run-1");
    const list = useTerminalStore.getState().persistedSessions["task-1"];
    expect(list.map((s) => s.agent_run_id)).toEqual(["run-2"]);
  });

  it("terminatePersisted refreshes scratch resumables with session context", async () => {
    vi.spyOn(api, "terminateTerminal").mockResolvedValue({
      agent_run_id: "plan-1",
      terminated: true,
    });
    const refresh = vi.spyOn(api, "listResumableTerminals").mockResolvedValue([]);
    useTerminalStore.getState().attachPersisted(
      makePersisted({
        agent_run_id: "plan-1",
        task_id: SCRATCH_RUN_TASK_ID,
        scope: "plan",
      }),
    );

    await useTerminalStore
      .getState()
      .terminatePersisted("plan-1", scratchBucketId("mod-1"));

    expect(refresh).toHaveBeenCalledWith(undefined, "proj-1", "mod-1");
  });

  it("resumePersisted refreshes lists, reattaches the new run, and returns the new id", async () => {
    vi.spyOn(api, "resumeTerminal").mockResolvedValue({
      agent_run_id: "run-new",
      resumed_from: "run-old",
    });
    vi.spyOn(api, "getTerminals").mockResolvedValue([
      makePersisted({ agent_run_id: "run-new" }),
    ]);
    vi.spyOn(api, "listResumableTerminals").mockResolvedValue([]);
    useTerminalStore.setState({
      persistedSessions: {
        "task-1": [makePersisted({ agent_run_id: "run-old", terminated_at: "2026-05-29T02:00:00Z" })],
      },
      resumableSessions: {
        "task-1": [
          {
            agent_run_id: "run-old",
            agent: "claude",
            status: "terminated",
            started_at: "2026-05-29T00:00:00Z",
            ended_at: "2026-05-29T02:00:00Z",
            provider_session_id: "ps-old",
            resumed_from: null,
          } as never,
        ],
      },
    });

    const newRunId = await useTerminalStore.getState().resumePersisted("run-old", "task-1");

    expect(newRunId).toBe("run-new");
    expect(useTerminalStore.getState().persistedSessions["task-1"]).toEqual([
      expect.objectContaining({ agent_run_id: "run-new" }),
    ]);
    expect(useTerminalStore.getState().resumableSessions["task-1"]).toEqual([]);
    expect(
      Object.values(useTerminalStore.getState().sessions).some(
        (session) => session.agentRunId === "run-new",
      ),
    ).toBe(true);
  });

  it("resumePersisted refreshes the same module-scoped Scratch history", async () => {
    const resumed = makePersisted({
      agent_run_id: "run-new",
      task_id: SCRATCH_RUN_TASK_ID,
      module_id: "mod-1",
      scope: "instant",
    });
    vi.spyOn(api, "resumeTerminal").mockResolvedValue({
      agent_run_id: "run-new",
      resumed_from: "run-old",
    });
    const getScratch = vi.spyOn(api, "getScratchTerminals").mockResolvedValue([resumed]);
    const listResumable = vi.spyOn(api, "listResumableTerminals").mockResolvedValue([]);

    await useTerminalStore.getState().resumePersisted(
      "run-old",
      scratchBucketId("mod-1"),
      "proj-1",
      "mod-1",
    );

    expect(getScratch).toHaveBeenCalledWith("proj-1", "mod-1");
    expect(listResumable).toHaveBeenCalledWith(undefined, "proj-1", "mod-1");
    expect(
      useTerminalStore.getState().resumableSessions[`${TEMP_TASK_ID}:proj-1:mod-1`],
    ).toEqual([]);
  });

  it("resumePersisted rejects on API failure and leaves state untouched", async () => {
    vi.spyOn(api, "resumeTerminal").mockRejectedValue(new Error("boom"));
    useTerminalStore.setState({
      persistedSessions: {
        "task-1": [makePersisted({ agent_run_id: "run-old" })],
      },
      resumableSessions: {
        "task-1": [
          {
            agent_run_id: "run-old",
            agent: "claude",
            status: "terminated",
            started_at: "2026-05-29T00:00:00Z",
            ended_at: "2026-05-29T02:00:00Z",
            provider_session_id: "ps-old",
            resumed_from: null,
          } as never,
        ],
      },
    });

    await expect(
      useTerminalStore.getState().resumePersisted("run-old", "task-1"),
    ).rejects.toThrow("boom");
    expect(useTerminalStore.getState().persistedSessions["task-1"][0].agent_run_id).toBe("run-old");
    expect(useTerminalStore.getState().resumableSessions["task-1"][0].agent_run_id).toBe("run-old");
  });

  // --- auto-reattach live-set persistence (#490) ---

  it("setReady persists the agent_run_id to the live-set", () => {
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1", "run-1");
    expect(liveRuns()).toEqual(["run-1"]);
  });

  it("setReady without an agent_run_id does not touch the live-set", () => {
    const tempId = useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      isPlanning: true,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1");
    expect(liveRuns()).toEqual([]);
  });

  it("clean exit drops the id; closeTab and terminate also drop it", async () => {
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1", "run-1");
    useTerminalStore.getState().setExited("sess-1");
    expect(liveRuns()).toEqual([]);

    // closeTab drops it too.
    const t2 = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(t2, "sess-2", "run-2");
    useTerminalStore.getState().closeTab("sess-2");
    expect(liveRuns()).toEqual([]);

    // terminatePersisted drops it too.
    vi.spyOn(api, "terminateTerminal").mockResolvedValue({
      agent_run_id: "run-3",
      terminated: true,
    });
    setLiveRuns(["run-3"]);
    await useTerminalStore.getState().terminatePersisted("run-3", "task-1");
    expect(liveRuns()).toEqual([]);
  });

  it("setError drops a stale id (4409 / session_not_found)", () => {
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1", "run-1");
    useTerminalStore.getState().setError("sess-1");
    expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("error");
    expect(liveRuns()).toEqual([]);
  });

  it("setSessionLost marks it lost, releases the claim, and drops the live-run id", () => {
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1", "run-1");
    // A surface foregrounds the session before it is lost.
    useTerminalForegroundStore.getState().acquire("run-1", "drawer");
    expect(liveRuns()).toEqual(["run-1"]);

    useTerminalStore.getState().setSessionLost("sess-1");

    expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("session_lost");
    // The foreground claim was released (key resolves back to studio).
    expect(resolveOwner(useTerminalForegroundStore.getState(), "run-1")).toBe("studio");
    // Not auto-reattach eligible anymore.
    expect(liveRuns()).toEqual([]);
  });

  it("lostConnection marks exited but RETAINS the id for a later reload", () => {
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1", "run-1");
    useTerminalStore.getState().lostConnection("sess-1");
    expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("exited");
    expect(useTerminalStore.getState().sessions["sess-1"].transport).toBe("closed");
    expect(liveRuns()).toEqual(["run-1"]);
  });

  it("re-attaches every non-terminated server session regardless of the live-set", async () => {
    // run-1 is in this browser's live-set; run-2 is NOT. The server reports
    // both as live, so both must get a tab — the server list is the source of
    // truth, not localStorage. (Regression: a relaunched run or a reload that
    // raced the `ready` write left a live session with no tab.)
    setLiveRuns(["run-1"]);
    vi.spyOn(api, "getTerminals").mockResolvedValue([
      makePersisted({ agent_run_id: "run-1" }),
      makePersisted({ agent_run_id: "run-2" }),
    ]);
    await useTerminalStore.getState().fetchPersistedSessions("task-1");
    const live = Object.values(useTerminalStore.getState().sessions);
    expect(live).toHaveLength(2);
    expect(live.map((m) => m.agentRunId).sort()).toEqual(["run-1", "run-2"]);
    expect(live.every((m) => m.status === "connecting")).toBe(true);
  });

  it("re-attaches a live session even when the live-set is empty", async () => {
    // Fresh browser / cleared storage: nothing in the live-set, but the
    // server reports a live session — it must still get a tab.
    setLiveRuns([]);
    vi.spyOn(api, "getTerminals").mockResolvedValue([
      makePersisted({ agent_run_id: "run-1" }),
    ]);
    await useTerminalStore.getState().fetchPersistedSessions("task-1");
    const live = Object.values(useTerminalStore.getState().sessions);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ status: "connecting", agentRunId: "run-1" });
  });

  it("restore drops a stale id when the session ended server-side", async () => {
    setLiveRuns(["run-1"]);
    vi.spyOn(api, "getTerminals").mockResolvedValue([
      makePersisted({ agent_run_id: "run-1", terminated_at: "2026-05-30T00:00:00Z" }),
    ]);
    await useTerminalStore.getState().fetchPersistedSessions("task-1");
    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(0);
    expect(liveRuns()).toEqual([]);
  });

  it("restore does not duplicate an already-live tab", async () => {
    // A tab is already attached/ready for run-1.
    const tempId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setReady(tempId, "sess-1", "run-1");
    vi.spyOn(api, "getTerminals").mockResolvedValue([
      makePersisted({ agent_run_id: "run-1" }),
    ]);
    await useTerminalStore.getState().fetchPersistedSessions("task-1");
    // No second session for run-1.
    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(1);
  });

  it("defers an unknown persisted run while the same bucket has an unbound spawn", () => {
    const spawnId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "proj-1",
      agent: "claude",
      ticketSeq: null,
    });
    useTerminalStore.getState().setPersisted("task-1", [
      makePersisted({ agent_run_id: "run-from-server" }),
    ]);

    useTerminalStore.getState().restoreLiveSessions("task-1");

    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual([spawnId]);

    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useWorkspaceTabsStore.setState({
      byTaskId: {},
      activeByTask: {},
      chatByDoc: {},
    });
    useTerminalStore.getState().restoreLiveSessions("task-1");

    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(1);
    expect(Object.values(useTerminalStore.getState().sessions)[0]).toMatchObject({
      agentRunId: "run-from-server",
      status: "connecting",
    });
  });
});

describe("selectScratchAgentCount (#496)", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: {},
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {}, chatByDoc: {} });
  });

  it("counts active plan and instant scratch sessions", () => {
    useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      isPlanning: true,
    });
    useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      isInstant: true,
    });

    expect(
      selectScratchAgentCount(useTerminalStore.getState()),
    ).toBe(2);
  });

  it("keeps module counts live as local sessions launch and exit", () => {
    const id = useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      moduleId: "mod-1",
      agent: "claude",
      ticketSeq: null,
      isInstant: true,
    });

    expect(selectScratchAgentCount(useTerminalStore.getState(), "mod-1")).toBe(1);
    expect(selectScratchAgentCount(useTerminalStore.getState(), "mod-2")).toBe(0);
    useTerminalStore.getState().setExited(id);
    expect(selectScratchAgentCount(useTerminalStore.getState(), "mod-1")).toBe(0);
  });

  it("excludes exited and error scratch sessions", () => {
    const exited = useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      isPlanning: true,
    });
    const errored = useTerminalStore.getState().openSession({
      taskId: null,
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      isInstant: true,
    });
    useTerminalStore.getState().setExited(exited);
    useTerminalStore.getState().setError(errored);

    expect(
      selectScratchAgentCount(useTerminalStore.getState()),
    ).toBe(0);
  });

  it("ignores real ticket-bound sessions", () => {
    useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "p",
      agent: "claude",
      ticketSeq: 1,
    });

    expect(
      selectScratchAgentCount(useTerminalStore.getState()),
    ).toBe(0);
  });

  it("never counts a doc-chat run (#625), even on the scratch bucket", () => {
    useTerminalStore.getState().openDocChat({
      taskId: null,
      projectId: "p",
      agent: "claude",
      ticketSeq: null,
      docRelPath: "d.html",
    });
    expect(selectScratchAgentCount(useTerminalStore.getState())).toBe(0);
  });
});
