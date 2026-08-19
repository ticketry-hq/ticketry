/**
 * The Studio run surface accepts a shell-shaped record (#665).
 *
 * A shell run is a run with the `shell` scope and no agent. It must travel
 * through the status store and the agent-run selectors without being mistaken
 * for an agent run, and without any reader substituting a provider slug for the
 * absent one. Agent runs must be unaffected in every one of those places.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { isAgentlessRun, SHELL_RUN_SCOPE } from "./runScopes";
import {
  MODULE_LIFECYCLE_STATES,
  selectModuleLifecycleCounts,
  selectScratchLifecycleChips,
  selectScratchRunIds,
  selectTaskRunCount,
} from "./selectors";
import { useAgentStatusStore } from "./store";
import type { RunRecord } from "./types";

const SCRATCH_TASK_ID = "00000000-0000-0000-0000-000000000000";

function agentRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    agent_run_id: "run-agent",
    project_id: "project-1",
    task_id: "task-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    started_at: "2026-08-15T09:00:00+00:00",
    state: "working",
    updated_at: "2026-08-15T09:00:00+00:00",
    ...overrides,
  };
}

/** The record a shell run produces: module-scoped, agentless, no lifecycle. */
function shellRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return agentRun({
    agent_run_id: "run-shell",
    task_id: null,
    agent: null,
    scope: SHELL_RUN_SCOPE,
    state: "unknown",
    ...overrides,
  });
}

beforeEach(() => {
  useAgentStatusStore.setState({
    projectId: "project-1",
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
});

describe("a run with no agent", () => {
  it("is recognised by its scope, not by the field being missing", () => {
    expect(isAgentlessRun(shellRun())).toBe(true);
    for (const scope of ["task", "plan", "instant", "docchat"] as const) {
      expect(isAgentlessRun(agentRun({ scope }))).toBe(false);
    }
  });

  it("survives a store round trip with its null agent intact", () => {
    useAgentStatusStore.getState().upsertRun(shellRun());

    const stored = useAgentStatusStore.getState().runs["run-shell"];
    expect(stored.agent).toBeNull();
    expect(stored.scope).toBe(SHELL_RUN_SCOPE);
  });

  it("does not disturb an agent run held alongside it", () => {
    useAgentStatusStore.getState().upsertRun(agentRun());
    useAgentStatusStore.getState().upsertRun(shellRun());

    const stored = useAgentStatusStore.getState().runs["run-agent"];
    expect(stored.agent).toBe("codex");
    expect(stored.scope).toBe("task");
    expect(stored.state).toBe("working");
  });
});

describe("agent activity surfaces stay agent-only", () => {
  it("counts no shell run in a task rollup", () => {
    useAgentStatusStore.getState().upsertRun(agentRun());
    // The record a shell run produces carries no task at all: it hangs off the
    // module's own work item, and task rollups match real task ids.
    useAgentStatusStore.getState().upsertRun(shellRun());

    const data = useAgentStatusStore.getState();
    expect(shellRun().task_id).toBeNull();
    expect(selectTaskRunCount(data, "task-1")).toBe(1);
    expect(selectTaskRunCount(data, SCRATCH_TASK_ID)).toBe(0);
  });

  it("shows no shell run among a module's scratch chicklets", () => {
    useAgentStatusStore
      .getState()
      .upsertRun(agentRun({ agent_run_id: "run-plan", task_id: null, scope: "plan" }));
    useAgentStatusStore.getState().upsertRun(shellRun());

    const data = useAgentStatusStore.getState();
    expect(selectScratchRunIds(data, "project-1", "module-1")).toEqual(["run-plan"]);
    // The plan run's own chip is unchanged by the shell run sharing its module.
    expect(
      selectScratchLifecycleChips(data, "project-1", "module-1"),
    ).toEqual([{ state: "working", count: 1 }]);
  });

  it("moves no module lifecycle count", () => {
    useAgentStatusStore.getState().upsertRun(shellRun());
    const withShellOnly = selectModuleLifecycleCounts(
      useAgentStatusStore.getState(),
      "module-1",
    );

    useAgentStatusStore.getState().upsertRun(agentRun());
    const withAgentToo = selectModuleLifecycleCounts(
      useAgentStatusStore.getState(),
      "module-1",
    );

    // This count has no scope filter: it holds only because a shell run has no
    // agent hooks and so never carries a countable lifecycle state. Pinned here
    // because nothing else declares it, and a shell run silently appearing in a
    // module badge is exactly how that would regress.
    expect(MODULE_LIFECYCLE_STATES).not.toContain(shellRun().state);
    expect(withShellOnly.working).toBe(0);
    expect(withAgentToo.working).toBe(1);
  });
});
