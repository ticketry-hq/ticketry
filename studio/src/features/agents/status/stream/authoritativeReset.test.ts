/**
 * The reset protocol in isolation: what is buffered, what is installed, when,
 * and what happens when the authoritative refresh never completes.
 */
import { describe, expect, it, vi } from "vitest";

import type { RunStatusEventFrame } from "../generated/statusStream";
import { createAuthoritativeReset } from "./authoritativeReset";

const frame = (cursor: number): RunStatusEventFrame =>
  ({
    __typename: "RunStatusEvent",
    cursor,
    event_id: `event-${cursor}`,
    project_id: "project",
    event_kind: "work_item.changed",
    payload_version: 1,
    subject_kind: "work_item",
    subject_id: "item",
    agent_run_id: null,
    automation_attempt_id: null,
    work_item_id: "item",
    payload: {},
    committed_at: "2026-08-16T10:00:00+00:00",
  }) as unknown as RunStatusEventFrame;

interface Recorder {
  readonly applied: number[];
  readonly installed: number[];
  readonly failures: number;
}

function harness(
  refresh: () => Promise<void> = () => Promise.resolve(),
  owns: () => boolean = () => true,
) {
  const applied: number[] = [];
  const installed: number[] = [];
  let failures = 0;
  const reset = createAuthoritativeReset({
    refresh,
    install: (cursor) => installed.push(cursor),
    applyEvent: (event) => applied.push(event.cursor),
    owns,
    onFailed: () => {
      failures += 1;
    },
  });
  const recorder: Recorder = {
    get applied() {
      return applied;
    },
    get installed() {
      return installed;
    },
    get failures() {
      return failures;
    },
  };
  return { reset, recorder };
}

describe("authoritative reset", () => {
  it("installs the baseline only after the refresh resolves", async () => {
    let release = () => {};
    const refresh = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const { reset, recorder } = harness(refresh);

    reset.begin(40);
    expect(reset.isRefreshing()).toBe(true);
    expect(recorder.installed).toEqual([]);

    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(recorder.installed).toEqual([40]);
    expect(reset.isRefreshing()).toBe(false);
  });

  it("drains buffered facts in cursor order, once, above the baseline", async () => {
    const { reset, recorder } = harness();

    reset.begin(40);
    // Out of order, duplicated, and one the refetched holdings already cover.
    expect(reset.capture(frame(42))).toBe(true);
    expect(reset.capture(frame(41))).toBe(true);
    expect(reset.capture(frame(42))).toBe(true);
    expect(reset.capture(frame(39))).toBe(true);
    expect(reset.capture(frame(40))).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(recorder.applied).toEqual([41, 42]);
    expect(recorder.installed).toEqual([40, 41, 42]);
    // Once drained, facts flow through the caller's normal path again.
    expect(reset.capture(frame(43))).toBe(false);
  });

  it("installs the baseline for an empty gap without applying anything", async () => {
    const { reset, recorder } = harness();

    reset.begin(40);
    await Promise.resolve();
    await Promise.resolve();

    expect(recorder.applied).toEqual([]);
    expect(recorder.installed).toEqual([40]);
  });

  it("keeps the buffer and baselines nothing when the refresh fails", async () => {
    const failing = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("canonical read failed"))
      .mockResolvedValue();
    const { reset, recorder } = harness(failing);

    reset.begin(40);
    reset.capture(frame(41));
    await Promise.resolve();
    await Promise.resolve();

    expect(recorder.failures).toBe(1);
    expect(recorder.installed).toEqual([]);
    expect(recorder.applied).toEqual([]);

    // The retry's reset drains the fact that was never delivered anywhere else.
    reset.begin(40);
    await Promise.resolve();
    await Promise.resolve();
    expect(recorder.installed).toEqual([40, 41]);
    expect(recorder.applied).toEqual([41]);
  });

  it("writes nothing when the subscription is superseded mid-reset", async () => {
    let owned = true;
    const { reset, recorder } = harness(
      () => Promise.resolve(),
      () => owned,
    );

    reset.begin(40);
    reset.capture(frame(41));
    owned = false;
    await Promise.resolve();
    await Promise.resolve();

    expect(recorder.installed).toEqual([]);
    expect(recorder.applied).toEqual([]);
    expect(recorder.failures).toBe(0);
  });

  it("cancellation drops the buffer and leaves no refresh in flight", async () => {
    let release = () => {};
    const { reset, recorder } = harness(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    reset.begin(40);
    reset.capture(frame(41));
    reset.cancel();
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(reset.isRefreshing()).toBe(false);
    expect(recorder.applied).toEqual([]);
    expect(recorder.installed).toEqual([]);
  });

  it("collapses a second reset into the refresh already in flight", async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { reset, recorder } = harness(refresh);

    reset.begin(40);
    reset.begin(45);
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    // The newer baseline wins: nothing at or below it may be replayed locally.
    expect(recorder.installed).toEqual([45]);
  });
});
