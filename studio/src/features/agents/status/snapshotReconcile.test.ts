/**
 * Snapshot reconciliation write rules (false "terminated" regression).
 *
 * A run the snapshot lists as alive must heal a locally held terminal state
 * even when the local stamp is newer: quiet runs keep an hours-old
 * authoritative timestamp, so a fabricated "exited"/"lost" would otherwise
 * pin the tab and ticket chicklets to "terminated" while the terminal is
 * perfectly healthy.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { RunRecord } from "./types";
import { useAgentStatusStore } from "./store";

const SCOPE = { project_id: "project-1", task_id: null };

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    agent_run_id: "run-1",
    project_id: "project-1",
    task_id: "task-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    started_at: "2026-08-10T09:00:00+00:00",
    state: "needs_input",
    updated_at: "2026-08-10T09:00:00+00:00",
    ...overrides,
  };
}

beforeEach(() => {
  useAgentStatusStore.setState({
    projectId: "project-1",
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
});

describe("reconcileScope healing", () => {
  it("restores a listed run over a newer locally held terminal state", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run({ state: "needs_input" }));
    // A fabricated exit always carries a fresher stamp than a quiet run's
    // last hook event.
    store.applyState("run-1", "exited", "2026-08-10T12:00:00+00:00");
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");

    useAgentStatusStore
      .getState()
      .reconcileScope(SCOPE, [run({ state: "needs_input" })], "2026-08-10T12:05:00+00:00");

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("needs_input");
  });

  it("restores a listed run over a locally held lost state", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run({ state: "working" }));
    store.applyState("run-1", "lost", "2026-08-10T12:00:00+00:00");

    useAgentStatusStore
      .getState()
      .reconcileScope(SCOPE, [run({ state: "working" })], "2026-08-10T12:05:00+00:00");

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");
  });

  it("keeps a listed tombstone authoritative over a live local record", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run({ state: "working" }));

    useAgentStatusStore.getState().reconcileScope(
      SCOPE,
      [run({ state: "exited", updated_at: "2026-08-10T11:00:00+00:00" })],
      "2026-08-10T11:00:01+00:00",
    );

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");
  });

  it("still applies a real exit delta after a snapshot heal", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run({ state: "needs_input" }));
    store.applyState("run-1", "exited", "2026-08-10T12:00:00+00:00");
    useAgentStatusStore
      .getState()
      .reconcileScope(SCOPE, [run({ state: "needs_input" })], "2026-08-10T12:05:00+00:00");

    useAgentStatusStore
      .getState()
      .applyState("run-1", "exited", "2026-08-10T12:06:00+00:00");

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");
  });
});

describe("reconcileScope absence marking", () => {
  it("marks a strictly older unlisted run as exited", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(run({ state: "working" }));

    useAgentStatusStore
      .getState()
      .reconcileScope(SCOPE, [], "2026-08-10T12:00:00+00:00");

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");
  });

  it("never declares an unlisted run exited on an equal stamp", () => {
    const at = "2026-08-10T12:00:00+00:00";
    const store = useAgentStatusStore.getState();
    store.upsertRun(run({ state: "starting", updated_at: at }));

    useAgentStatusStore.getState().reconcileScope(SCOPE, [], at);

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("starting");
  });

  it("never declares a run spawned after the snapshot stamp exited", () => {
    const store = useAgentStatusStore.getState();
    store.upsertRun(
      run({ state: "starting", updated_at: "2026-08-10T12:00:00.500000+00:00" }),
    );

    useAgentStatusStore
      .getState()
      .reconcileScope(SCOPE, [], "2026-08-10T12:00:00+00:00");

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("starting");
  });
});
