import { describe, expect, it } from "vitest";
import {
  selectModuleLifecycleChips,
  selectTaskLifecycleChips,
} from "./selectors";
import type { AgentStatusData, RunRecord } from "./types";

const AT = "2026-08-15T12:00:00.000Z";

function run(id: string, agent: string, state: RunRecord["state"]): RunRecord {
  return {
    agent_run_id: id,
    project_id: "project-1",
    task_id: "story-1",
    module_id: "module-1",
    agent,
    scope: "task",
    started_at: AT,
    state,
    effective_state: state,
    updated_at: AT,
  } as RunRecord;
}

const status = {
  projectId: "project-1",
  runs: {
    a: run("a", "claude", "working"),
    b: run("b", "codex", "working"),
    c: run("c", "codex", "working"),
    d: run("d", "claude", "needs_input"),
    e: run("e", "codex", "needs_input"),
  },
  automationAttempts: {},
  automationByTask: {},
} as unknown as AgentStatusData;

describe("running chips split by provider (#2251)", () => {
  it("gives each provider its own running chip on a work item", () => {
    expect(selectTaskLifecycleChips(status, "story-1")).toEqual([
      { state: "needs_input", count: 2 },
      { state: "working", count: 1, agent: "claude" },
      { state: "working", count: 2, agent: "codex" },
    ]);
  });

  it("gives each provider its own running chip on a module", () => {
    expect(selectModuleLifecycleChips(status, "module-1")).toEqual([
      { state: "needs_input", count: 2 },
      { state: "working", count: 1, agent: "claude" },
      { state: "working", count: 2, agent: "codex" },
    ]);
  });
});
