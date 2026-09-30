import { beforeEach, describe, expect, it } from "vitest";

import { resetStudioApolloClient, studioApolloClient } from "../../../shared/apollo/client";
import { installDesktopGraphQlRuntime } from "../../../test/desktopGraphQlRuntime";
import type { RunRecord } from "./types";
import {
  applyAgentRunState,
  readAgentStatusHolding,
  replaceAgentStatusSnapshot,
  switchAgentStatusProject,
} from "./apolloHolding";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";

function run(): RunRecord {
  return {
    agent_run_id: "run-1",
    project_id: PROJECT,
    task_id: "task-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    launch_state: "Implement",
    launch_model: "gpt-5",
    started_at: "2026-08-26T08:00:00Z",
    state: "working",
    effective_state: "working",
    updated_at: "2026-08-26T08:01:00Z",
    output_sequence: 3,
    last_output_at: "2026-08-26T08:01:00Z",
  };
}

describe("Apollo status holding", () => {
  beforeEach(async () => {
    installDesktopGraphQlRuntime();
    await resetStudioApolloClient();
  });

  it("normalizes snapshot runs and drops the previous project on switch", () => {
    switchAgentStatusProject(PROJECT);
    replaceAgentStatusSnapshot(PROJECT, [run()], []);

    expect(readAgentStatusHolding()).toMatchObject({
      projectId: PROJECT,
      runs: { "run-1": { state: "working", output_sequence: 3 } },
    });
    const cache = studioApolloClient().cache.extract() as Record<string, unknown>;
    expect(cache["AgentRuns:{\"id\":\"run-1\"}"]).toMatchObject({
      __typename: "AgentRuns",
      id: "run-1",
    });

    switchAgentStatusProject(OTHER_PROJECT);

    expect(readAgentStatusHolding()).toMatchObject({
      projectId: OTHER_PROJECT,
      runs: {},
    });
    const switched = studioApolloClient().cache.extract() as Record<string, unknown>;
    expect(switched["AgentRuns:{\"id\":\"run-1\"}"]).toBeUndefined();
  });

  it("applies an incremental state event only to a known run", () => {
    switchAgentStatusProject(PROJECT);
    replaceAgentStatusSnapshot(PROJECT, [run()], []);

    expect(
      applyAgentRunState(
        "run-1",
        "needs_input",
        "2026-08-26T08:02:00Z",
      ),
    ).toBe(true);
    expect(readAgentStatusHolding().runs["run-1"]).toMatchObject({
      state: "needs_input",
      effective_state: "needs_input",
    });
    expect(
      applyAgentRunState(
        "missing-run",
        "working",
        "2026-08-26T08:03:00Z",
      ),
    ).toBe(false);
  });
});
