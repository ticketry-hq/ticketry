import { describe, expect, it } from "vitest";
import {
  initialUpdateState,
  transitionUpdate,
} from "./updateMachine";

describe("update state machine", () => {
  it("records an available update returned by the check", () => {
    expect(
      transitionUpdate(initialUpdateState, {
        type: "update-available",
        availableVersion: "0.3.0",
        notes: "Faster startup.",
      }),
    ).toEqual({
      status: "available",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
  });

  it("tracks download bytes and percent when the total is known", () => {
    const available = transitionUpdate(initialUpdateState, {
      type: "update-available",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
    const downloading = transitionUpdate(available, {
      type: "download-started",
    });

    expect(
      transitionUpdate(downloading, {
        type: "download-progress",
        receivedBytes: 256,
        totalBytes: 1_024,
      }),
    ).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      progress: {
        receivedBytes: 256,
        totalBytes: 1_024,
        percent: 25,
      },
    });
  });

  it("keeps download progress indeterminate when the total is unknown", () => {
    const available = transitionUpdate(initialUpdateState, {
      type: "update-available",
      availableVersion: "0.3.0",
    });
    const downloading = transitionUpdate(available, {
      type: "download-started",
    });

    expect(
      transitionUpdate(downloading, {
        type: "download-progress",
        receivedBytes: 384,
      }),
    ).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      progress: {
        receivedBytes: 384,
        totalBytes: null,
        percent: null,
      },
    });
  });

  it("requires confirmation after the download finishes", () => {
    const available = transitionUpdate(initialUpdateState, {
      type: "update-available",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
    const downloading = transitionUpdate(available, {
      type: "download-started",
    });

    expect(
      transitionUpdate(downloading, { type: "download-completed" }),
    ).toEqual({
      status: "ready-to-install",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
  });

  it("starts installation only after the user confirms", () => {
    expect(
      transitionUpdate(
        {
          status: "ready-to-install",
          availableVersion: "0.3.0",
          notes: "Faster startup.",
        },
        { type: "install-confirmed" },
      ),
    ).toEqual({
      status: "installing",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
    });
  });

  it("requests restart after installation completes", () => {
    expect(
      transitionUpdate(
        { status: "installing", availableVersion: "0.3.0" },
        { type: "installation-completed" },
      ),
    ).toEqual({
      status: "restart-requested",
      availableVersion: "0.3.0",
    });
  });

  it("reports signature rejection as a distinct failure", () => {
    expect(
      transitionUpdate(
        { status: "installing", availableVersion: "0.3.0" },
        { type: "signature-rejected" },
      ),
    ).toEqual({
      status: "failed",
      failureKind: "signature-rejected",
      message: "Update rejected: invalid signature.",
      retryTarget: "check",
    });
  });

  it("makes an interrupted download retryable from download", () => {
    expect(
      transitionUpdate(
        {
          status: "downloading",
          availableVersion: "0.3.0",
          notes: "Faster startup.",
          progress: {
            receivedBytes: 384,
            totalBytes: 1_024,
            percent: 37.5,
          },
        },
        {
          type: "transient-failure",
          message: "The download was interrupted.",
        },
      ),
    ).toEqual({
      status: "failed",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      failureKind: "transient",
      message: "The download was interrupted.",
      retryTarget: "download",
    });
  });

  it("makes an unreachable feed retryable from check", () => {
    expect(
      transitionUpdate(initialUpdateState, {
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

  it("retries a signature rejection from check", () => {
    expect(
      transitionUpdate(
        {
          status: "failed",
          failureKind: "signature-rejected",
          message: "Update rejected: invalid signature.",
          retryTarget: "check",
        },
        { type: "retry" },
      ),
    ).toEqual({ status: "checking" });
  });

  it("retries an interrupted download from the beginning", () => {
    expect(
      transitionUpdate(
        {
          status: "failed",
          availableVersion: "0.3.0",
          notes: "Faster startup.",
          failureKind: "transient",
          message: "The download was interrupted.",
          retryTarget: "download",
        },
        { type: "retry" },
      ),
    ).toEqual({
      status: "downloading",
      availableVersion: "0.3.0",
      notes: "Faster startup.",
      progress: {
        receivedBytes: 0,
        totalBytes: null,
        percent: null,
      },
    });
  });
});
