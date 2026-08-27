import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { resetStudioApolloClient } from "../../../shared/apollo/client";
import { installDesktopGraphQlRuntime } from "../../../test/desktopGraphQlRuntime";
import {
  applyAgentRunState,
  replaceAgentStatusSnapshot,
  switchAgentStatusProject,
} from "./apolloHolding";
import { useTaskLifecycleChips } from "./hooks";
import type { RunRecord } from "./types";

const PROJECT = "11111111-1111-1111-1111-111111111111";

function run(id: string, taskId: string): RunRecord {
  return {
    agent_run_id: id,
    project_id: PROJECT,
    task_id: taskId,
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    launch_state: "Implement",
    launch_model: "gpt-5",
    started_at: "2099-08-26T08:00:00Z",
    state: "working",
    effective_state: "working",
    updated_at: "2099-08-26T08:01:00Z",
    output_sequence: 0,
    last_output_at: "2099-08-26T08:01:00Z",
  };
}

describe("Apollo status hooks", () => {
  beforeEach(async () => {
    installDesktopGraphQlRuntime();
    await resetStudioApolloClient();
    switchAgentStatusProject(PROJECT);
    replaceAgentStatusSnapshot(
      PROJECT,
      [run("run-a", "task-a"), run("run-b", "task-b")],
      [],
    );
  });

  it("does not rerender a task aggregate when an unrelated run changes", () => {
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useTaskLifecycleChips("task-a");
    });
    const initialRenders = renders;

    act(() => {
      applyAgentRunState(
        "run-b",
        "needs_input",
        "2099-08-26T08:02:00Z",
      );
    });

    expect(hook.result.current).toEqual([{ state: "working", count: 1 }]);
    expect(renders).toBe(initialRenders);
  });
});
