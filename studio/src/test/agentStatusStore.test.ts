import { beforeEach, describe, expect, it } from "vitest";
import type { RunRecord } from "@worktracker/typescript-sdk";
import {
  selectRunState,
  selectScratchLifecycleChips,
  selectTaskAgentLifecycle,
  selectTaskRunCount,
  toAgentLifecycle,
  useAgentStatusStore,
} from "../features/agents/status";

const timestampAtMinute = (minute: number) =>
  `2026-07-12T15:${String(minute).padStart(2, "0")}:00Z`;

function run(
  runId: string,
  taskId: string | null,
  state: RunRecord["state"] = "working",
  updatedAt = timestampAtMinute(0),
  moduleId = "module-1",
  scope: RunRecord["scope"] = "task",
): RunRecord {
  return {
    agent_run_id: runId,
    task_id: taskId,
    module_id: moduleId,
    scope,
    state,
    updated_at: updatedAt,
  };
}

beforeEach(() => {
  useAgentStatusStore.setState({ runs: {}, byTask: {} });
});

describe("agentStatusStore reducers", () => {
  it("upserts runs and re-indexes a run whose task changes", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run("run-1", "task-1"));
    store.upsertRun(run("run-1", "task-2", "needs_input", timestampAtMinute(1)));

    expect(useAgentStatusStore.getState().runs["run-1"]).toEqual({
      runId: "run-1",
      taskId: "task-2",
      moduleId: "module-1",
      scope: "task",
      state: "needs_input",
      updatedAt: timestampAtMinute(1),
    });
    expect(useAgentStatusStore.getState().byTask).toEqual({ "task-2": ["run-1"] });
  });

  it("applies only state changes at least as fresh as the stored run", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run("run-1", "task-1", "working", timestampAtMinute(2)));
    store.applyState("run-1", "error", timestampAtMinute(1));
    expect(selectRunState(useAgentStatusStore.getState(), "run-1")).toBe("working");

    store.applyState("run-1", "turn_complete", timestampAtMinute(3));
    expect(selectRunState(useAgentStatusStore.getState(), "run-1")).toBe(
      "turn_complete",
    );
  });

  it("reconciles a narrow scope without clobbering fresher data", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run("fresh-listed", "task-1", "error", timestampAtMinute(5)));
    store.upsertRun(run("stale-absent", "task-1", "working", timestampAtMinute(1)));
    store.upsertRun(run("fresh-absent", "task-1", "working", timestampAtMinute(5)));
    store.upsertRun(run("other-task", "task-2", "working", timestampAtMinute(1)));

    store.reconcileScope(
      { project_id: "project-1", task_id: "task-1" },
      [run("fresh-listed", "task-1", "quiet", timestampAtMinute(2))],
      timestampAtMinute(3),
    );

    const state = useAgentStatusStore.getState();
    expect(state.runs["fresh-listed"].state).toBe("error");
    expect(state.runs["stale-absent"]).toMatchObject({
      state: "exited",
      updatedAt: timestampAtMinute(3),
    });
    expect(state.runs["fresh-absent"].state).toBe("working");
    expect(state.runs["other-task"].state).toBe("working");
  });

  it("tombstones absent records in a full scope", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run("listed", "task-1", "working", timestampAtMinute(1)));
    store.upsertRun(run("absent", "task-2", "working", timestampAtMinute(1)));

    store.reconcileScope(
      { project_id: "project-1", task_id: null },
      [run("listed", "task-1", "quiet", timestampAtMinute(2))],
      timestampAtMinute(2),
    );

    expect(useAgentStatusStore.getState().runs["listed"].state).toBe("quiet");
    expect(useAgentStatusStore.getState().runs["absent"]).toMatchObject({
      state: "exited",
      updatedAt: timestampAtMinute(2),
    });
  });

  it("prunes only old tombstones", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run("old-exit", "task-1", "exited", timestampAtMinute(1)));
    store.upsertRun(run("old-lost", "task-1", "lost", timestampAtMinute(1)));
    store.upsertRun(run("new-exit", "task-1", "exited", timestampAtMinute(4)));
    store.upsertRun(run("active", "task-1", "working", timestampAtMinute(1)));

    store.pruneRuns(timestampAtMinute(3));

    expect(Object.keys(useAgentStatusStore.getState().runs).sort()).toEqual([
      "active",
      "new-exit",
    ]);
    expect(useAgentStatusStore.getState().byTask["task-1"].sort()).toEqual([
      "active",
      "new-exit",
    ]);
  });
});

describe("agentStatusStore selectors", () => {
  it("groups only Plan and Instant lifecycle states for the active module", () => {
    const store = useAgentStatusStore.getState();
    useAgentStatusStore.setState({ projectId: "project-1" });
    store.upsertRun(run("lost-plan", null, "lost", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("error-instant", null, "error", timestampAtMinute(1), "module-1", "instant"));
    store.upsertRun(run("input-plan", null, "needs_input", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("permission-plan", null, "permission_required", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("done-plan", null, "turn_complete", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("working-plan", null, "working", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("working-instant", null, "working", timestampAtMinute(1), "module-1", "instant"));
    store.upsertRun(run("starting-plan", null, "starting", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("reconnecting-plan", null, "reconnecting", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("quiet-plan", null, "quiet", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("task-bound", "task-1", "working", timestampAtMinute(1), "module-1", "task"));
    store.upsertRun(run("doc-chat", null, "working", timestampAtMinute(1), "module-1", "docchat"));
    store.upsertRun(run("other-module", null, "working", timestampAtMinute(1), "module-2", "plan"));
    store.upsertRun(run("exited", null, "exited", timestampAtMinute(1), "module-1", "plan"));
    store.upsertRun(run("unknown", null, "unknown", timestampAtMinute(1), "module-1", "instant"));

    expect(
      selectScratchLifecycleChips(
        useAgentStatusStore.getState(),
        "project-1",
        "module-1",
      ),
    ).toEqual([
      { state: "lost", count: 1 },
      { state: "error", count: 1 },
      { state: "needs_input", count: 1 },
      { state: "permission_required", count: 1 },
      { state: "turn_complete", count: 1 },
      { state: "working", count: 2 },
      { state: "starting", count: 1 },
      { state: "reconnecting", count: 1 },
      { state: "quiet", count: 1 },
    ]);
    expect(
      selectScratchLifecycleChips(
        useAgentStatusStore.getState(),
        "project-2",
        "module-1",
      ),
    ).toEqual([]);
  });

  it("collapses all raw states into the three badge states", () => {
    const active: RunRecord["state"][] = [
      "starting", "working", "permission_required", "reconnecting",
    ];
    const attention: RunRecord["state"][] = [
      "needs_input", "turn_complete", "error", "lost",
    ];
    const idle: Array<RunRecord["state"] | null> = ["quiet", "exited", "unknown", null];
    expect(active.map(toAgentLifecycle)).toEqual([
      "active",
      "active",
      "active",
      "active",
    ]);
    expect(attention.map(toAgentLifecycle)).toEqual([
      "attention",
      "attention",
      "attention",
      "attention",
    ]);
    expect(idle.map(toAgentLifecycle)).toEqual([
      "idle",
      "idle",
      "idle",
      "idle",
    ]);
  });

  it("rolls a task and its descendants up with attention winning", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run("parent-run", "parent", "working"));
    store.upsertRun(run("child-run", "child", "needs_input"));

    expect(selectTaskAgentLifecycle(useAgentStatusStore.getState(), "parent")).toBe(
      "active",
    );
    expect(
      selectTaskAgentLifecycle(useAgentStatusStore.getState(), "parent", ["child"]),
    ).toBe("attention");
  });

  it("counts non-exited runs across a task and its descendants", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run("parent-active", "parent", "working"));
    store.upsertRun(run("parent-exited", "parent", "exited"));
    store.upsertRun(run("parent-lost", "parent", "lost"));
    store.upsertRun(run("child-active", "child", "quiet"));

    expect(selectTaskRunCount(useAgentStatusStore.getState(), "parent", ["child"])).toBe(2);
  });
});
