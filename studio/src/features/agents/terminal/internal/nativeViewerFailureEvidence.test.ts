import { afterEach, describe, expect, it } from "vitest";

import {
  nativeViewerFailureEvidence,
  recordNativeViewerFailureEvidence,
  resetNativeViewerFailureEvidence,
} from "./nativeViewerFailureEvidence";

describe("native viewer failure evidence ledger", () => {
  afterEach(() => resetNativeViewerFailureEvidence());

  it("keeps origin, reason, handle and the serialised error per report", () => {
    const error = new Error("resize failed");
    recordNativeViewerFailureEvidence("run-1", {
      origin: "frame-sync",
      reason: "resize failed",
      handle: "h-1",
      error,
    });

    const [entry] = nativeViewerFailureEvidence();
    expect(entry).toMatchObject({
      runId: "run-1",
      origin: "frame-sync",
      reason: "resize failed",
      handle: "h-1",
      error: { name: "Error", message: "resize failed" },
    });
    expect(entry.error).toHaveProperty("stack");
    expect(typeof entry.at).toBe("string");
  });

  it("drops the oldest entries past the bound", () => {
    for (let index = 0; index < 60; index += 1) {
      recordNativeViewerFailureEvidence(`run-${index}`, {
        origin: "attach",
        reason: "x",
      });
    }
    const entries = nativeViewerFailureEvidence();
    expect(entries.length).toBe(50);
    expect(entries[0].runId).toBe("run-10");
  });
});
