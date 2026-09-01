import { describe, expect, it } from "vitest";
import { initialUpdateState, transitionUpdate } from "./updateMachine";

describe("update state machine", () => {
  it("turns an available update into the user confirmation state", () => {
    expect(
      transitionUpdate({ status: "checking" }, {
        type: "update-available",
        availableVersion: "0.3.0",
        notes: "Faster startup.",
      }),
    ).toEqual({
      status: "ready-to-install",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
  });

  it("starts downloading only after the user confirms the update", () => {
    expect(
      transitionUpdate(
        { status: "ready-to-install", availableVersion: "0.3.0" },
        { type: "update-confirmed" },
      ),
    ).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      progress: { receivedBytes: 0, totalBytes: null, percent: null },
    });
  });

  it("tracks download bytes and percent when the total is known", () => {
    expect(
      transitionUpdate(
        {
          status: "downloading",
          availableVersion: "0.3.0",
          progress: { receivedBytes: 0, totalBytes: null, percent: null },
        },
        { type: "download-progress", receivedBytes: 256, totalBytes: 1_024 },
      ),
    ).toMatchObject({
      status: "downloading",
      progress: { receivedBytes: 256, totalBytes: 1_024, percent: 25 },
    });
  });

  it("keeps download progress indeterminate when the total is unknown", () => {
    expect(
      transitionUpdate(
        {
          status: "downloading",
          availableVersion: "0.3.0",
          progress: { receivedBytes: 0, totalBytes: null, percent: null },
        },
        { type: "download-progress", receivedBytes: 384 },
      ),
    ).toMatchObject({
      status: "downloading",
      progress: { receivedBytes: 384, totalBytes: null, percent: null },
    });
  });

  it("moves from download completion through install to restart requested", () => {
    const installing = transitionUpdate(
      {
        status: "downloading",
        availableVersion: "0.3.0",
        progress: { receivedBytes: 1_024, totalBytes: 1_024, percent: 100 },
      },
      { type: "download-completed" },
    );

    expect(installing).toEqual({
      status: "installing",
      availableVersion: "0.3.0",
    });
    expect(
      transitionUpdate(installing, { type: "installation-completed" }),
    ).toEqual({
      status: "restart-requested",
      availableVersion: "0.3.0",
    });
  });

  it("reports invalid signatures distinctly and retries from check", () => {
    const failed = transitionUpdate(
      {
        status: "downloading",
        availableVersion: "0.3.0",
        progress: { receivedBytes: 1_024, totalBytes: 1_024, percent: 100 },
      },
      {
        type: "operation-failed",
        failureKind: "signature-rejected",
        message: "Update rejected: invalid signature.",
      },
    );

    expect(failed).toEqual({
      status: "failed",
      failureKind: "signature-rejected",
      message: "Update rejected: invalid signature.",
      retryTarget: "check",
    });
    expect(transitionUpdate(failed, { type: "retry" })).toEqual({
      status: "checking",
    });
  });

  it("retries an interrupted download from the beginning", () => {
    const failed = transitionUpdate(
      {
        status: "downloading",
        availableVersion: "0.3.0",
        notes: "Faster startup.",
        progress: { receivedBytes: 384, totalBytes: 1_024, percent: 37.5 },
      },
      {
        type: "operation-failed",
        failureKind: "transient",
        message: "The download was interrupted.",
      },
    );

    expect(transitionUpdate(failed, { type: "retry" })).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      progress: { receivedBytes: 0, totalBytes: null, percent: null },
    });
  });

  it("ignores late progress after a failed operation", () => {
    const failed = {
      status: "failed" as const,
      failureKind: "transient" as const,
      message: "The download was interrupted.",
      retryTarget: "download" as const,
      availableVersion: "0.3.0",
    };

    expect(
      transitionUpdate(failed, {
        type: "download-progress",
        receivedBytes: 512,
        totalBytes: 1_024,
      }),
    ).toBe(failed);
  });

  it("keeps current and check failures inside the same state owner", () => {
    expect(
      transitionUpdate(initialUpdateState, { type: "check-started" }),
    ).toEqual({ status: "checking" });
    expect(
      transitionUpdate({ status: "checking" }, { type: "check-current" }),
    ).toEqual({ status: "current" });
    expect(
      transitionUpdate({ status: "checking" }, {
        type: "operation-failed",
        failureKind: "transient",
        message: "The update feed could not be reached.",
      }),
    ).toEqual({
      status: "failed",
      failureKind: "transient",
      message: "The update feed could not be reached.",
      retryTarget: "check",
    });
  });
});
