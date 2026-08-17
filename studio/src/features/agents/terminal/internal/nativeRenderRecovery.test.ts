import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS,
  configureNativeRenderRecovery,
  nativeRenderRecoveryPending,
  reportNativeRenderFailure,
  reportNativeRenderSuccess,
  resetNativeRenderRecovery,
} from "./nativeRenderRecovery";

describe("native render recovery policy", () => {
  const reload = vi.fn();
  let restore: () => void;

  beforeEach(() => {
    reload.mockReset();
    restore = configureNativeRenderRecovery({ reload });
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetNativeRenderRecovery();
    vi.useRealTimers();
    restore();
  });

  it("refreshes once, 500 milliseconds after the first failure", () => {
    reportNativeRenderFailure("run-1", "native terminal attachment failed");

    expect(nativeRenderRecoveryPending()).toBe(true);
    vi.advanceTimersByTime(INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS - 1);
    expect(reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledOnce();
    expect(nativeRenderRecoveryPending()).toBe(false);
  });

  it("keeps one timer when several viewers report the same incident", () => {
    reportNativeRenderFailure("run-1", "attachment failed");
    reportNativeRenderFailure("run-1", "lease renewal failed");
    reportNativeRenderFailure("run-1", "native resize failed");

    vi.advanceTimersByTime(10_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("cancels a pending refresh when a native viewer presents", () => {
    reportNativeRenderFailure("run-1", "attachment failed");
    reportNativeRenderSuccess("run-1");

    expect(nativeRenderRecoveryPending()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the refresh booked when a different run presents", () => {
    reportNativeRenderFailure("run-broken", "attachment failed");

    reportNativeRenderSuccess("run-healthy");

    expect(nativeRenderRecoveryPending()).toBe(true);
    vi.advanceTimersByTime(INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("clears the campaign only once every failing run has presented", () => {
    reportNativeRenderFailure("run-one", "attachment failed");
    reportNativeRenderFailure("run-two", "lease renewal failed");

    reportNativeRenderSuccess("run-one");
    expect(nativeRenderRecoveryPending()).toBe(true);

    reportNativeRenderSuccess("run-two");
    expect(nativeRenderRecoveryPending()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("stops holding the campaign once the broken surface is gone", () => {
    const retire = reportNativeRenderFailure("run-broken", "attachment failed");

    retire();
    reportNativeRenderSuccess("run-healthy");

    expect(nativeRenderRecoveryPending()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the campaign while any competing host still shows the fallback", () => {
    const workspace = reportNativeRenderFailure("run-broken", "attachment failed");
    reportNativeRenderFailure("run-broken", "attachment failed");

    // Only one of the two hosts presenting that run went away.
    workspace();
    reportNativeRenderSuccess("run-healthy");

    expect(nativeRenderRecoveryPending()).toBe(true);
    vi.advanceTimersByTime(INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("clears recovery idempotently when no campaign is pending", () => {
    reportNativeRenderSuccess("run-1");
    reportNativeRenderSuccess("run-1");

    expect(nativeRenderRecoveryPending()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses to reload when success wins the race with an expiring timer", () => {
    const scheduled: { expire: (() => void) | null } = { expire: null };
    const timeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((handler) => {
        scheduled.expire = handler as () => void;
        return 11 as unknown as ReturnType<typeof setTimeout>;
      });
    reportNativeRenderFailure("run-1", "attachment failed");
    timeout.mockRestore();

    // The timer already expired into the task queue when the viewer recovered.
    reportNativeRenderSuccess("run-1");
    scheduled.expire?.();

    expect(reload).not.toHaveBeenCalled();
  });

  it("starts a later independent failure at the initial delay", () => {
    reportNativeRenderFailure("run-1", "attachment failed");
    reportNativeRenderSuccess("run-1");

    reportNativeRenderFailure("run-1", "native resize failed");
    vi.advanceTimersByTime(INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("survives a reload boundary that throws without leaving a campaign", () => {
    reload.mockImplementation(() => {
      throw new Error("reload unavailable");
    });

    reportNativeRenderFailure("run-1", "attachment failed");
    expect(() => vi.advanceTimersByTime(INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS))
      .toThrow("reload unavailable");
    expect(nativeRenderRecoveryPending()).toBe(false);
  });

  it("keeps recovery retryable after a reload boundary that never refreshed", () => {
    reportNativeRenderFailure("run-1", "attachment failed");
    vi.advanceTimersByTime(INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();

    // The stub did not destroy the document, so the same coordinator must be
    // free to book the next attempt rather than being stuck mid-campaign.
    reportNativeRenderFailure("run-1", "attachment failed again");
    expect(nativeRenderRecoveryPending()).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("native render recovery across documents", () => {
  const reload = vi.fn();
  let restore: (() => void) | null = null;
  let current: typeof import("./nativeRenderRecovery") | null = null;

  /**
   * A fresh coordinator in a fresh document: the module the refresh destroyed
   * is replaced by a new instance, while window-session storage carries on.
   */
  async function nextDocument() {
    restore?.();
    vi.resetModules();
    const module = await import("./nativeRenderRecovery");
    restore = module.configureNativeRenderRecovery({ reload });
    current = module;
    return module;
  }

  /** Drives one whole failure→refresh cycle and reports the delay it used. */
  async function refreshAfterFailure(reason: string): Promise<number> {
    const coordinator = await nextDocument();
    const before = reload.mock.calls.length;
    coordinator.reportNativeRenderFailure("run-1", reason);
    let elapsed = 0;
    while (reload.mock.calls.length === before && elapsed <= 60_000) {
      vi.advanceTimersByTime(1);
      elapsed += 1;
    }
    return elapsed;
  }

  beforeEach(() => {
    reload.mockReset();
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    current?.resetNativeRenderRecovery();
    current = null;
    restore?.();
    restore = null;
    vi.useRealTimers();
    vi.resetModules();
  });

  it("grows the delay across refreshes and settles on the ten second cap", async () => {
    const delays: number[] = [];
    for (let refreshes = 0; refreshes < 8; refreshes += 1) {
      delays.push(await refreshAfterFailure("terminal attachment failed"));
    }

    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
  });

  it("never gives up: an arbitrarily late attempt still refreshes at the cap", async () => {
    window.sessionStorage.setItem(
      "ticketry.terminal.nativeRenderRecovery",
      JSON.stringify({ version: 1, nextAttempt: 500 }),
    );

    expect(await refreshAfterFailure("native resize failed")).toBe(10_000);
  });

  it("stores the incremented attempt before each refresh", async () => {
    const coordinator = await nextDocument();
    coordinator.reportNativeRenderFailure("run-1", "attachment failed");
    expect(window.sessionStorage.getItem("ticketry.terminal.nativeRenderRecovery"))
      .toBeNull();

    vi.advanceTimersByTime(500);
    expect(reload).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        window.sessionStorage.getItem("ticketry.terminal.nativeRenderRecovery") ?? "null",
      ),
    ).toEqual({ version: 1, nextAttempt: 1 });
  });

  it("records the consumed attempt even when the reload boundary throws", async () => {
    reload.mockImplementation(() => {
      throw new Error("reload unavailable");
    });
    const coordinator = await nextDocument();
    coordinator.reportNativeRenderFailure("run-1", "attachment failed");
    expect(() => vi.advanceTimersByTime(500)).toThrow("reload unavailable");

    expect(
      JSON.parse(
        window.sessionStorage.getItem("ticketry.terminal.nativeRenderRecovery") ?? "null",
      ),
    ).toEqual({ version: 1, nextAttempt: 1 });
  });

  it.each([
    ["no record", null],
    ["unparseable text", "not json at all"],
    ["a non-object record", "7"],
    ["an unknown schema version", JSON.stringify({ version: 9, nextAttempt: 4 })],
    ["a missing attempt", JSON.stringify({ version: 1 })],
    ["a negative attempt", JSON.stringify({ version: 1, nextAttempt: -3 })],
    ["a fractional attempt", JSON.stringify({ version: 1, nextAttempt: 2.5 })],
    ["a non-numeric attempt", JSON.stringify({ version: 1, nextAttempt: "4" })],
  ])("restarts safely at the initial delay given %s", async (_label, stored) => {
    if (stored !== null) {
      window.sessionStorage.setItem("ticketry.terminal.nativeRenderRecovery", stored);
    }

    expect(await refreshAfterFailure("attachment failed")).toBe(500);
  });

  it("clears the cross-refresh campaign when a native viewer finally presents", async () => {
    await refreshAfterFailure("attachment failed");
    await refreshAfterFailure("attachment failed");
    const recovered = await nextDocument();

    recovered.reportNativeRenderSuccess("run-1");
    expect(window.sessionStorage.getItem("ticketry.terminal.nativeRenderRecovery"))
      .toBeNull();

    // The next unrelated incident is a new campaign, not the grown one.
    expect(await refreshAfterFailure("native resize failed")).toBe(500);
  });

  it("keeps the grown attempt when a healthy run presents during the unload window", async () => {
    const coordinator = await nextDocument();
    coordinator.reportNativeRenderFailure("run-broken", "attachment failed");
    vi.advanceTimersByTime(500);
    expect(reload).toHaveBeenCalledOnce();

    // The document is on its way out; a still-mounted healthy viewer commits a
    // frame. The broken run never recovered, so the backoff must not restart.
    coordinator.reportNativeRenderSuccess("run-healthy");
    expect(
      JSON.parse(
        window.sessionStorage.getItem("ticketry.terminal.nativeRenderRecovery") ?? "null",
      ),
    ).toEqual({ version: 1, nextAttempt: 1 });

    expect(await refreshAfterFailure("attachment failed")).toBe(1_000);
  });

  it("clears the campaign idempotently and refuses a stale reload afterwards", async () => {
    await refreshAfterFailure("attachment failed");
    const coordinator = await nextDocument();

    const scheduled: { expire: (() => void) | null } = { expire: null };
    const timeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((handler) => {
        scheduled.expire = handler as () => void;
        return 12 as unknown as ReturnType<typeof setTimeout>;
      });
    coordinator.reportNativeRenderFailure("run-1", "attachment failed");
    timeout.mockRestore();

    const refreshes = reload.mock.calls.length;
    coordinator.reportNativeRenderSuccess("run-1");
    coordinator.reportNativeRenderSuccess("run-1");
    // The timer had already expired into the task queue when the viewer came
    // back; its callback belongs to a campaign that no longer exists.
    scheduled.expire?.();

    expect(reload).toHaveBeenCalledTimes(refreshes);
    expect(window.sessionStorage.getItem("ticketry.terminal.nativeRenderRecovery"))
      .toBeNull();
  });
});
