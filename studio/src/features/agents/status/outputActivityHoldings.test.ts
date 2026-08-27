import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStatusStore } from "./testStore";
import { applySnapshotFrame } from "./stream/statusSnapshot";
import { statusRunHolding } from "./testing/durableStatusFrames";
import {
  projectRunPresentation,
  stallDeadlineAt,
  STALL_AFTER_MS,
} from "./runPresentation";
import { startStallDeadlines, stopStallDeadlines } from "./stallDeadlines";
import { selectRunState, selectTaskLifecycleChips } from "./selectors";
import type { RunRecord } from "./types";

const OBSERVED_AT = "2026-08-15T12:00:00.000Z";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    agent_run_id: "run-1",
    project_id: "project-1",
    task_id: "story-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    launch_state: "Implement",
    launch_model: "gpt-5.6",
    started_at: OBSERVED_AT,
    state: "working",
    effective_state: "working",
    updated_at: OBSERVED_AT,
    output_sequence: 1,
    last_output_at: OBSERVED_AT,
    ...overrides,
  };
}

function holding() {
  return useAgentStatusStore.getState();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(OBSERVED_AT));
  useAgentStatusStore.setState({
    projectId: "project-1",
    runs: {},
    automationAttempts: {},
    automationByTask: {},
    stallEpoch: 0,
  });
});

afterEach(() => {
  stopStallDeadlines();
  vi.useRealTimers();
});

describe("terminal output activity projection", () => {
  it("projects stalled at exactly the unchanged-output boundary", () => {
    const record = run();

    vi.advanceTimersByTime(STALL_AFTER_MS - 1);
    expect(projectRunPresentation(record)).toBe("working");

    vi.advanceTimersByTime(1);
    expect(projectRunPresentation(record)).toBe("stalled");
  });

  it("restores the latest provider lifecycle fact, not a manufactured Working", () => {
    // The provider last reported inactivity. Time passing makes that
    // presentation stalled; changed output must return it to Quiet.
    const idle = run({ state: "quiet" });
    vi.advanceTimersByTime(STALL_AFTER_MS);
    expect(projectRunPresentation(idle)).toBe("stalled");

    const resumed = { ...idle, last_output_at: new Date().toISOString() };
    expect(projectRunPresentation(resumed)).toBe("quiet");
  });

  it("never overlays a run that is waiting on the user", () => {
    // A waiting terminal produces no output by definition, so the heuristic
    // would take the attention signal away and never give it back (#681).
    vi.advanceTimersByTime(STALL_AFTER_MS * 10);
    expect(projectRunPresentation(run({ state: "needs_input" }))).toBe(
      "needs_input",
    );
    expect(projectRunPresentation(run({ state: "permission_required" }))).toBe(
      "permission_required",
    );
    expect(stallDeadlineAt(run({ state: "needs_input" }))).toBeNull();
  });

  it("never overlays a run that already reached a terminal outcome", () => {
    vi.advanceTimersByTime(STALL_AFTER_MS * 10);
    expect(projectRunPresentation(run({ state: "exited", effective_state: "stalled" })))
      .toBe("exited");
    expect(projectRunPresentation(run({ state: "lost", effective_state: "stalled" })))
      .toBe("lost");
  });

  it("has no deadline for a session with no recorded output origin", () => {
    vi.advanceTimersByTime(STALL_AFTER_MS * 10);
    expect(projectRunPresentation(run({ last_output_at: null }))).toBe("working");
  });
});

describe("independently ordered lifecycle and activity axes", () => {
  it("advances the activity axis without claiming a lifecycle state", () => {
    holding().upsertRun(run({
      state: "needs_input",
      effective_state: "needs_input",
      output_sequence: 1,
    }));

    holding().applyActivity(
      run({
        state: "working",
        effective_state: "working",
        output_sequence: 2,
        last_output_at: "2026-08-15T12:01:00.000Z",
      }),
    );

    const stored = holding().runs["run-1"];
    expect(stored.output_sequence).toBe(2);
    expect(stored.last_output_at).toBe("2026-08-15T12:01:00.000Z");
    expect(stored.effective_state).toBe("working");
    // The activity delta carried a `working` record; the run's own lifecycle
    // fact is what survives.
    expect(stored.state).toBe("needs_input");
  });

  it("ignores an activity frame that is not newer by output sequence", () => {
    holding().upsertRun(run({ output_sequence: 5, last_output_at: OBSERVED_AT }));

    holding().applyActivity(
      run({ output_sequence: 4, last_output_at: "2026-08-15T11:00:00.000Z" }),
    );

    expect(holding().runs["run-1"].output_sequence).toBe(5);
    expect(holding().runs["run-1"].last_output_at).toBe(OBSERVED_AT);
  });

  it("keeps a newer activity fact when an older lifecycle frame is applied", () => {
    holding().upsertRun(run({ output_sequence: 7, last_output_at: OBSERVED_AT }));

    // An older lifecycle frame loses its own axis but must not rewind activity.
    holding().upsertRun(
      run({
        state: "starting",
        updated_at: "2026-08-15T11:00:00.000Z",
        output_sequence: 2,
        last_output_at: "2026-08-15T11:00:00.000Z",
      }),
    );

    expect(holding().runs["run-1"].state).toBe("working");
    expect(holding().runs["run-1"].output_sequence).toBe(7);
    expect(holding().runs["run-1"].last_output_at).toBe(OBSERVED_AT);
  });

  it("reconstructs the same effective state from a reconnect snapshot", () => {
    // A snapshot seeded on the far side of the boundary must present stalled
    // immediately, from persisted facts alone.
    const stale = new Date(Date.now() - STALL_AFTER_MS).toISOString();
    applySnapshotFrame({
      __typename: "RunStatusSnapshot",
      project_id: "project-1",
      cursor: 9,
      runs: [statusRunHolding(run({ output_sequence: 9, last_output_at: stale }))],
      automation_attempts: [],
      at: new Date().toISOString(),
    });

    expect(selectRunState(holding(), "run-1")).toBe("stalled");
    expect(holding().runs["run-1"].output_sequence).toBe(9);
  });
});

describe("terminal outcomes outrank the inactivity overlay", () => {
  it("keeps an explicitly terminated run exited past the deadline", () => {
    holding().upsertRun(run());
    startStallDeadlines();

    // The tab's X terminated through the backend; the confirmed ending
    // arrives on the feed.
    holding().applyState("run-1", "exited", "2026-08-15T12:00:30.000Z");
    expect(selectRunState(holding(), "run-1")).toBe("exited");

    // Time alone can no longer reach this run: its deadline was disposed with
    // the outcome, so the coordinator never even wakes up for it.
    vi.advanceTimersByTime(STALL_AFTER_MS * 5);
    expect(holding().stallEpoch).toBe(0);
    expect(selectRunState(holding(), "run-1")).toBe("exited");
  });

  it("ignores an activity observation that raced the ending", () => {
    holding().upsertRun(run({ state: "exited", updated_at: OBSERVED_AT }));

    holding().applyActivity(
      run({
        state: "working",
        output_sequence: 9,
        last_output_at: "2026-08-15T12:00:30.000Z",
      }),
    );

    const stored = holding().runs["run-1"];
    expect(stored.state).toBe("exited");
    // The frozen axis leaves nothing a later reader could re-arm a deadline
    // from.
    expect(stored.output_sequence).toBe(1);
    expect(stored.last_output_at).toBe(OBSERVED_AT);
    expect(selectRunState(holding(), "run-1")).toBe("exited");
  });

  it("cannot be moved back to stalled by a late activity frame", () => {
    holding().upsertRun(run({ state: "exited", updated_at: OBSERVED_AT }));
    startStallDeadlines();

    holding().applyActivity(
      run({ output_sequence: 4, last_output_at: OBSERVED_AT }),
    );
    vi.advanceTimersByTime(STALL_AFTER_MS * 5);

    expect(selectRunState(holding(), "run-1")).toBe("exited");
    expect(selectTaskLifecycleChips(holding(), "story-1")).toEqual([]);
  });

  it("keeps the missing-session outcome ahead of the overlay", () => {
    holding().upsertRun(run());
    startStallDeadlines();

    holding().applyState("run-1", "lost", "2026-08-15T12:00:30.000Z");
    vi.advanceTimersByTime(STALL_AFTER_MS * 5);

    expect(selectRunState(holding(), "run-1")).toBe("lost");
    expect(selectTaskLifecycleChips(holding(), "story-1")).toEqual([
      { state: "lost", count: 1 },
    ]);
  });

  it("reconstructs a terminated run as exited from either side of the boundary", () => {
    // The persisted facts say the run ended long after its last output; a
    // reconnect on either side of the threshold must read the same outcome.
    const stale = new Date(Date.now() - STALL_AFTER_MS * 3).toISOString();
    for (const at of [new Date(Date.now() - 1).toISOString(), stale]) {
      useAgentStatusStore.setState({ runs: {} });
      applySnapshotFrame({
        __typename: "RunStatusSnapshot",
        project_id: "project-1",
        cursor: 10,
        runs: [statusRunHolding(run({
          state: "exited",
          effective_state: "exited",
          updated_at: at,
          last_output_at: at,
        }))],
        automation_attempts: [],
        at: new Date().toISOString(),
      });
      expect(selectRunState(holding(), "run-1")).toBe("exited");
    }
  });
});

describe("the unchanged-output deadline coordinator", () => {
  it("moves a live run to stalled at the boundary without a server message", () => {
    holding().upsertRun(run());
    startStallDeadlines();

    expect(selectRunState(holding(), "run-1")).toBe("working");

    vi.advanceTimersByTime(STALL_AFTER_MS);

    expect(holding().runs["run-1"].effective_state).toBe("stalled");
    expect(selectRunState(holding(), "run-1")).toBe("stalled");
    expect(selectTaskLifecycleChips(holding(), "story-1")).toEqual([
      { state: "stalled", count: 1 },
    ]);
  });

  it("reschedules on changed output and clears the overlay", () => {
    holding().upsertRun(run());
    startStallDeadlines();
    vi.advanceTimersByTime(STALL_AFTER_MS);
    expect(selectRunState(holding(), "run-1")).toBe("stalled");

    holding().applyActivity(
      run({ output_sequence: 2, last_output_at: new Date().toISOString() }),
    );
    expect(selectRunState(holding(), "run-1")).toBe("working");

    vi.advanceTimersByTime(STALL_AFTER_MS - 1);
    expect(selectRunState(holding(), "run-1")).toBe("working");
    vi.advanceTimersByTime(1);
    expect(selectRunState(holding(), "run-1")).toBe("stalled");
  });

  it("clears a stall when the provider reports the run is waiting on the user", () => {
    holding().upsertRun(run());
    startStallDeadlines();
    vi.advanceTimersByTime(STALL_AFTER_MS);
    expect(selectRunState(holding(), "run-1")).toBe("stalled");

    // The agent asked a question. No further output will ever arrive to clear
    // the overlay, so the lifecycle fact itself has to win it back.
    holding().applyState("run-1", "needs_input", "2026-08-15T12:01:00.000Z");
    expect(selectRunState(holding(), "run-1")).toBe("needs_input");

    vi.advanceTimersByTime(STALL_AFTER_MS * 5);
    expect(selectRunState(holding(), "run-1")).toBe("needs_input");
    expect(selectTaskLifecycleChips(holding(), "story-1")).toEqual([
      { state: "needs_input", count: 1 },
    ]);
  });

  it("disposes deadlines belonging to a project that is no longer selected", () => {
    holding().upsertRun(run());
    startStallDeadlines();

    holding().switchProject("project-2");
    vi.advanceTimersByTime(STALL_AFTER_MS * 2);

    expect(holding().runs).toEqual({});
    expect(holding().stallEpoch).toBe(0);
  });
});
