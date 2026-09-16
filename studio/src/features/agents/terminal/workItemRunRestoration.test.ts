import { describe, expect, it } from "vitest";

import { adaptScratchEndedRuns, adaptStoryEndedRuns } from "./workItemRunRestoration";
import type { WorkItemEndedRunsQuery } from "./generated/workItemRunRestoration.documents";

type EndedRunNode =
  WorkItemEndedRunsQuery["work_item"]["nodes"][number]["ended_runs"]["nodes"][number];

function endedRun(overrides: Partial<EndedRunNode> = {}): EndedRunNode {
  const agentRunId = overrides.agent_run_id ?? "run-1";
  return {
    agent_run_id: agentRunId,
    agent: "claude",
    scope: "task",
    status: "exited",
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:10:00Z",
    exit_code: 0,
    launch_state: "Implement",
    launch_model: "opus",
    provider_session_id: "conversation-1",
    terminal_session: {
      nodes: [{ agent_run_id: agentRunId, terminated_at: null }],
    },
    ...overrides,
  };
}

function workItem(
  id: string,
  runs: EndedRunNode[],
  moduleId: string | null = "module-1",
): WorkItemEndedRunsQuery {
  return {
    work_item: {
      nodes: [
        {
          id,
          project_id: "project-1",
          module_id: moduleId,
          ended_runs: { nodes: runs },
        },
      ],
    },
  };
}

function story(runs: EndedRunNode[]): WorkItemEndedRunsQuery {
  return workItem("story-1", runs);
}

describe("adaptStoryEndedRuns", () => {
  it("restores an ended run that still has a terminal session record", () => {
    expect(adaptStoryEndedRuns(story([endedRun()]))).toEqual([
      {
        agent_run_id: "run-1",
        project_id: "project-1",
        task_id: "story-1",
        module_id: "module-1",
        agent: "claude",
        scope: "task",
        launch_state: "Implement",
        launch_model: "opus",
        provider_session_id: "conversation-1",
        started_at: "2026-01-01T00:00:00Z",
        state: "exited",
        effective_state: "exited",
        updated_at: "2026-01-01T00:10:00Z",
        exit_code: 0,
      },
    ]);
  });

  it("drops an ended run with no terminal session record, however recent", () => {
    const runs = adaptStoryEndedRuns(
      story([endedRun({ terminal_session: { nodes: [] } })]),
    );
    expect(runs).toEqual([]);
  });

  it("drops an ended run whose terminal session was terminated", () => {
    const runs = adaptStoryEndedRuns(
      story([
        endedRun({
          terminal_session: {
            nodes: [{ agent_run_id: "run-1", terminated_at: "2026-01-01T00:10:00Z" }],
          },
        }),
      ]),
    );
    expect(runs).toEqual([]);
  });

  it("restores an old run because the record decides, not a calendar cutoff", () => {
    const runs = adaptStoryEndedRuns(
      story([
        endedRun({
          started_at: "2019-01-01T00:00:00Z",
          ended_at: "2019-01-01T00:05:00Z",
        }),
      ]),
    );
    expect(runs.map((run) => run.agent_run_id)).toEqual(["run-1"]);
  });

  it("projects a lost run the way the pushed holding does", () => {
    const runs = adaptStoryEndedRuns(story([endedRun({ status: "lost" })]));
    expect(runs[0].state).toBe("lost");
    expect(runs[0].effective_state).toBe("lost");
  });

  it("treats a Story with no module placement as its own module", () => {
    const data = story([endedRun()]);
    data.work_item.nodes[0].module_id = null;
    expect(adaptStoryEndedRuns(data)[0].module_id).toBe("story-1");
  });

  it("holds nothing for a Story the read did not return", () => {
    expect(adaptStoryEndedRuns(undefined)).toEqual([]);
    expect(adaptStoryEndedRuns({ work_item: { nodes: [] } })).toEqual([]);
  });
});

describe("adaptScratchEndedRuns", () => {
  it("places a module's ended scratch run on the module and on no task", () => {
    const runs = adaptScratchEndedRuns(
      workItem("module-1", [endedRun({ agent_run_id: "run-plan", scope: "plan" })], null),
    );
    expect(runs).toEqual([
      expect.objectContaining({
        agent_run_id: "run-plan",
        project_id: "project-1",
        task_id: null,
        module_id: "module-1",
        scope: "plan",
      }),
    ]);
  });

  it("restores a shell run, which carries no provider", () => {
    const runs = adaptScratchEndedRuns(
      workItem("module-1", [
        endedRun({ agent_run_id: "run-shell", scope: "shell", agent: null }),
      ]),
    );
    expect(runs[0].scope).toBe("shell");
    expect(runs[0].agent).toBeNull();
  });

  it("drops a scratch run with no terminal session record", () => {
    expect(
      adaptScratchEndedRuns(
        workItem("module-1", [
          endedRun({ scope: "instant", terminal_session: { nodes: [] } }),
        ]),
      ),
    ).toEqual([]);
  });

  it("drops a shell run whose terminal session was terminated", () => {
    // No provider conversation, so `excludeResumableTerminalRuns` never masks
    // this one: the terminated record has to be read here.
    const runs = adaptScratchEndedRuns(
      workItem("module-1", [
        endedRun({
          agent_run_id: "run-shell",
          scope: "shell",
          agent: null,
          provider_session_id: null,
          terminal_session: {
            nodes: [
              { agent_run_id: "run-shell", terminated_at: "2026-01-01T00:10:00Z" },
            ],
          },
        }),
      ]),
    );
    expect(runs).toEqual([]);
  });

  it("holds nothing for a module the read did not return", () => {
    expect(adaptScratchEndedRuns(undefined)).toEqual([]);
    expect(adaptScratchEndedRuns({ work_item: { nodes: [] } })).toEqual([]);
  });
});
