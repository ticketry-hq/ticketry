import { LaunchkeyMiniMK3, type MidiTransport } from "@bandwati/launchkey-adaptor";
import { describe, expect, it } from "vitest";

import type { AgentStatusData, RunRecord } from "../agents/status";
import { createRunPadProjection } from "./runPadProjection";

class RecordingMidiTransport implements MidiTransport {
  readonly sent: Array<{ port: "midi" | "daw"; data: number[] }> = [];

  onMessage(): () => void {
    return () => {};
  }

  send(port: "midi" | "daw", data: number[]): void {
    this.sent.push({ port, data: [...data] });
  }
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    agent_run_id: "run-1",
    project_id: "project-1",
    task_id: "task-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    started_at: "2026-09-04T08:00:00.000Z",
    state: "working",
    updated_at: "2026-09-04T08:00:01.000Z",
    ...overrides,
  };
}

function holding(
  runs: readonly RunRecord[],
  projectId: string | null = "project-1",
): AgentStatusData {
  return {
    projectId,
    runs: Object.fromEntries(runs.map((record) => [record.agent_run_id, record])),
    automationAttempts: {},
    automationByTask: {},
    stallEpoch: 0,
  };
}

describe("Launchkey run pad projection", () => {
  const projectionOn = (transport: RecordingMidiTransport) =>
    createRunPadProjection(new LaunchkeyMiniMK3(transport).output.pads);

  it("lights the oldest eligible agent on pad 1 and excludes shell terminals", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);

    projection.update(holding([
      run({
        agent_run_id: "shell",
        agent: null,
        scope: "shell",
        started_at: "2026-09-04T07:00:00.000Z",
      }),
      run(),
    ]));

    expect(transport.sent).toContainEqual({
      port: "daw",
      data: [0x90, 96, 3],
    });
    expect(transport.sent).not.toContainEqual({
      port: "daw",
      data: [0x90, 97, 3],
    });
  });

  it("projects every run presentation as its specified pad light", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);

    const presentations = [
      run({ agent_run_id: "working", state: "working" }),
      run({ agent_run_id: "input", state: "needs_input" }),
      run({ agent_run_id: "permission", state: "permission_required" }),
      run({ agent_run_id: "complete", state: "turn_complete" }),
      run({ agent_run_id: "quiet", state: "quiet" }),
      run({ agent_run_id: "stalled", state: "working", effective_state: "stalled" }),
      run({ agent_run_id: "starting", state: "starting" }),
      run({ agent_run_id: "reconnecting", state: "reconnecting" }),
      run({ agent_run_id: "error", state: "error" }),
      run({ agent_run_id: "lost", state: "lost" }),
    ].map((record, index) => ({
      ...record,
      started_at: `2026-09-04T08:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    projection.update(holding(presentations.map((record) => ({ ...record, state: "working" }))));
    projection.update(holding(presentations));

    const latestLights = new Map(
      transport.sent.filter(({ data }) => data[2] > 0)
        .map((message) => [message.data[1], message]),
    );
    expect([...latestLights.values()]).toEqual([
      { port: "daw", data: [0x90, 96, 3] },
      { port: "daw", data: [0x92, 97, 13] },
      { port: "daw", data: [0x91, 98, 3] },
      { port: "daw", data: [0x90, 99, 21] },
      { port: "daw", data: [0x90, 100, 41] },
      { port: "daw", data: [0x90, 101, 13] },
      { port: "daw", data: [0x92, 102, 3] },
      { port: "daw", data: [0x92, 103, 3] },
      { port: "daw", data: [0x90, 112, 5] },
      { port: "daw", data: [0x90, 113, 5] },
    ]);
  });

  it("keeps the selected run bright and dims every other lit pad", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);
    const runs = [
      run({ agent_run_id: "run-1", started_at: "2026-09-04T08:00:01.000Z" }),
      run({ agent_run_id: "run-2", state: "turn_complete", started_at: "2026-09-04T08:00:02.000Z" }),
    ];

    projection.update(holding(runs), "run-2");
    expect(transport.sent.filter(({ data }) => data[2] > 0)).toEqual([
      { port: "daw", data: [0x90, 96, 1] },
      { port: "daw", data: [0x90, 97, 21] },
    ]);

    transport.sent.length = 0;
    projection.update(holding(runs), null);
    expect(transport.sent.filter(({ data }) => data[2] > 0)).toEqual([
      { port: "daw", data: [0x90, 96, 3] },
    ]);
  });

  it("closes the gap when a run exits and appends the next run in order", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);
    const runAt = (id: string, second: number, state: RunRecord["state"] = "working") =>
      run({
        agent_run_id: id,
        state,
        started_at: `2026-09-04T08:00:${String(second).padStart(2, "0")}.000Z`,
      });

    projection.update(holding([
      runAt("run-1", 1),
      runAt("run-2", 2),
      runAt("run-3", 3),
    ]));
    transport.sent.length = 0;

    projection.update(holding([
      runAt("run-1", 1, "exited"),
      runAt("run-2", 2, "needs_input"),
      runAt("run-3", 3),
      runAt("run-4", 4, "permission_required"),
    ]));

    expect(transport.sent.filter(({ data }) => data[2] > 0)).toEqual([
      { port: "daw", data: [0x92, 96, 13] },
      { port: "daw", data: [0x91, 98, 3] },
    ]);
  });

  it("orders pads like the Stories tree: conversations, tree order, then unknown tasks", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);

    projection.update(holding([
      run({ agent_run_id: "deep", task_id: "task-2", state: "turn_complete",
        started_at: "2026-09-04T08:00:01.000Z" }),
      run({ agent_run_id: "top", task_id: "task-1", state: "working",
        started_at: "2026-09-04T08:00:02.000Z" }),
      run({ agent_run_id: "chat", task_id: null, state: "needs_input",
        started_at: "2026-09-04T08:00:03.000Z" }),
      run({ agent_run_id: "elsewhere", task_id: "other-module-task",
        state: "permission_required", started_at: "2026-09-04T08:00:00.000Z" }),
    ]), null, ["task-1", "task-2"]);

    expect(transport.sent.filter(({ data }) => data[2] > 0)).toEqual([
      { port: "daw", data: [0x92, 96, 13] },
      { port: "daw", data: [0x90, 97, 3] },
      { port: "daw", data: [0x90, 98, 21] },
      { port: "daw", data: [0x91, 99, 3] },
    ]);
  });

  it("holds failed runs until pressed, then shifts the overflow up without reviving acknowledged failures", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);
    const runs = Array.from({ length: 17 }, (_, index) => run({
      agent_run_id: `run-${String(index + 1).padStart(2, "0")}`,
      state: index === 0 ? "error" : index === 1 ? "lost" :
        index === 16 ? "needs_input" : "working",
      started_at: `2026-09-04T08:00:${String(index).padStart(2, "0")}.000Z`,
    }));

    projection.update(holding(runs.map((record) => ({ ...record, state: "working" }))));
    projection.update(holding(runs));
    transport.sent.length = 0;
    projection.update(holding(runs));
    expect(transport.sent).toEqual([]);

    expect(projection.press(1)).toBe("run-01");
    expect(transport.sent.filter(({ data }) => data[2] > 0)).toEqual([
      { port: "daw", data: [0x90, 97, 3] },
      { port: "daw", data: [0x92, 119, 13] },
    ]);

    transport.sent.length = 0;
    expect(projection.press(1)).toBe("run-02");
    expect(transport.sent).toEqual([
      { port: "daw", data: [0x90, 96, 0] },
      { port: "daw", data: [0x91, 96, 0] },
      { port: "daw", data: [0x92, 96, 0] },
      { port: "daw", data: [0x90, 96, 3] },
      { port: "daw", data: [0x90, 118, 0] },
      { port: "daw", data: [0x91, 118, 0] },
      { port: "daw", data: [0x92, 118, 0] },
      { port: "daw", data: [0x92, 118, 13] },
      { port: "daw", data: [0x90, 119, 0] },
      { port: "daw", data: [0x91, 119, 0] },
      { port: "daw", data: [0x92, 119, 0] },
    ]);

    transport.sent.length = 0;
    projection.update(holding(runs));
    expect(transport.sent).toEqual([]);
  });

  it("retains a failed run dropped from the snapshot until its red pad is pressed", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);
    const failed = run({ agent_run_id: "failed", state: "error" });
    const live = run({
      agent_run_id: "live",
      started_at: "2026-09-04T08:00:01.000Z",
    });

    projection.update(holding([{ ...failed, state: "working" }, live]));
    projection.update(holding([failed, live]));
    transport.sent.length = 0;
    projection.update(holding([live]));
    expect(transport.sent).toEqual([]);

    expect(projection.press(1)).toBe("failed");
    expect(transport.sent).toEqual([
      { port: "daw", data: [0x90, 96, 0] },
      { port: "daw", data: [0x91, 96, 0] },
      { port: "daw", data: [0x92, 96, 0] },
      { port: "daw", data: [0x90, 96, 3] },
      { port: "daw", data: [0x90, 97, 0] },
      { port: "daw", data: [0x91, 97, 0] },
      { port: "daw", data: [0x92, 97, 0] },
    ]);
  });

  it("clears old assignments and rebuilds them in start order when the project changes", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);

    projection.update(holding([
      run({ agent_run_id: "old-1", state: "working" }),
      run({
        agent_run_id: "old-2",
        state: "needs_input",
        started_at: "2026-09-04T08:00:01.000Z",
      }),
    ]));
    transport.sent.length = 0;

    projection.update(holding([
      run({
        agent_run_id: "new",
        project_id: "project-2",
        state: "permission_required",
      }),
    ], "project-2"));

    expect(transport.sent).toEqual([
      { port: "daw", data: [0x90, 96, 0] },
      { port: "daw", data: [0x91, 96, 0] },
      { port: "daw", data: [0x92, 96, 0] },
      { port: "daw", data: [0x91, 96, 3] },
      { port: "daw", data: [0x90, 97, 0] },
      { port: "daw", data: [0x91, 97, 0] },
      { port: "daw", data: [0x92, 97, 0] },
    ]);
  });

  it("includes doc-chat agents while ignoring earlier shell runs", () => {
    const transport = new RecordingMidiTransport();
    const projection = projectionOn(transport);

    projection.update(holding([
      run({
        agent_run_id: "shell",
        scope: "shell",
        agent: null,
        started_at: "2026-09-04T07:00:00.000Z",
      }),
      run({
        agent_run_id: "doc-chat",
        scope: "docchat",
        state: "permission_required",
      }),
    ]));

    expect(transport.sent.filter(({ data }) => data[2] > 0)).toEqual([
      { port: "daw", data: [0x91, 96, 3] },
    ]);
  });
});
