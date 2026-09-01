import { describe, expect, it } from "vitest";
import {
  initialUpdateState,
  isApplyingUpdate,
  transitionUpdate,
  type UpdateState,
} from "./updateMachine";

const CHECKING = transitionUpdate(initialUpdateState, {
  type: "check-started",
});

function available(notes?: string): UpdateState {
  return transitionUpdate(CHECKING, {
    type: "update-available",
    availableVersion: "0.3.0",
    ...(notes === undefined ? {} : { notes }),
  });
}

function downloading(notes?: string): UpdateState {
  return transitionUpdate(available(notes), { type: "install-confirmed" });
}

describe("update state machine", () => {
  it("starts idle and reports the check result", () => {
    expect(initialUpdateState).toEqual({ status: "idle" });
    expect(CHECKING).toEqual({ status: "checking" });
    expect(transitionUpdate(CHECKING, { type: "update-current" })).toEqual({
      status: "current",
    });
    expect(available("Faster startup.")).toEqual({
      status: "available",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
  });

  it("ignores a check result that no longer belongs to a running check", () => {
    const current: UpdateState = { status: "current" };

    expect(transitionUpdate(current, { type: "update-current" })).toBe(current);
    expect(
      transitionUpdate(current, {
        type: "update-available",
        availableVersion: "0.3.0",
      }),
    ).toBe(current);
  });

  it("downloads only after the user confirms the install", () => {
    expect(
      transitionUpdate(available("Faster startup."), {
        type: "download-progress",
        receivedBytes: 256,
        totalBytes: 1_024,
      }),
    ).toEqual(available("Faster startup."));
    expect(downloading("Faster startup.")).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      progress: { receivedBytes: 0, totalBytes: null, percent: null },
    });
  });

  it("tracks download bytes and percent when the total is known", () => {
    expect(
      transitionUpdate(downloading("Faster startup."), {
        type: "download-progress",
        receivedBytes: 256,
        totalBytes: 1_024,
      }),
    ).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      progress: { receivedBytes: 256, totalBytes: 1_024, percent: 25 },
    });
  });

  it("keeps download progress indeterminate when the total is unknown", () => {
    expect(
      transitionUpdate(downloading(), {
        type: "download-progress",
        receivedBytes: 384,
      }),
    ).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      progress: { receivedBytes: 384, totalBytes: null, percent: null },
    });
    expect(
      transitionUpdate(downloading(), {
        type: "download-progress",
        receivedBytes: 0,
        totalBytes: 0,
      }),
    ).toMatchObject({
      progress: { receivedBytes: 0, totalBytes: 0, percent: null },
    });
  });

  it("requests a restart only once installation completed", () => {
    expect(
      transitionUpdate(available(), { type: "installation-completed" }),
    ).toEqual(available());
    expect(
      transitionUpdate(downloading("Faster startup."), {
        type: "installation-completed",
      }),
    ).toEqual({
      status: "restart-requested",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
  });

  it("refuses a rejected signature terminally, sending the user back to a check", () => {
    const rejected = transitionUpdate(downloading("Faster startup."), {
      type: "signature-rejected",
      message: "Update rejected: invalid signature.",
    });

    expect(rejected).toEqual({
      status: "failed",
      failureKind: "signature-rejected",
      message: "Update rejected: invalid signature.",
      retryTarget: "check",
    });
    // The archive is discarded rather than reinstalled, so confirming an
    // install again cannot resume it.
    expect(transitionUpdate(rejected, { type: "install-confirmed" })).toBe(
      rejected,
    );
    expect(transitionUpdate(rejected, { type: "check-started" })).toEqual({
      status: "checking",
    });
  });

  it("keeps a transient install failure retryable against the same release", () => {
    const failed = transitionUpdate(downloading("Faster startup."), {
      type: "transient-failure",
      message: "The update download did not finish.",
    });

    expect(failed).toEqual({
      status: "failed",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      failureKind: "transient",
      message: "The update download did not finish.",
      retryTarget: "install",
    });
    expect(transitionUpdate(failed, { type: "install-confirmed" })).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      progress: { receivedBytes: 0, totalBytes: null, percent: null },
    });
  });

  it("keeps a failed check retryable as a check", () => {
    expect(
      transitionUpdate(CHECKING, {
        type: "transient-failure",
        message: "The update feed could not be reached.",
      }),
    ).toEqual({
      status: "failed",
      failureKind: "transient",
      message: "The update feed could not be reached.",
      retryTarget: "check",
    });
  });

  it("ignores progress that arrives after the install already failed", () => {
    const failed = transitionUpdate(downloading(), {
      type: "transient-failure",
      message: "The update download did not finish.",
    });

    expect(
      transitionUpdate(failed, {
        type: "download-progress",
        receivedBytes: 4_096,
        totalBytes: 4_096,
      }),
    ).toBe(failed);
  });

  it("never restarts a check while an update is being applied or awaiting restart", () => {
    const applying = downloading();
    const restartRequested = transitionUpdate(applying, {
      type: "installation-completed",
    });

    expect(transitionUpdate(applying, { type: "check-started" })).toBe(applying);
    expect(transitionUpdate(restartRequested, { type: "check-started" })).toBe(
      restartRequested,
    );
    expect(isApplyingUpdate(applying)).toBe(true);
    expect(isApplyingUpdate(restartRequested)).toBe(false);
  });
});
