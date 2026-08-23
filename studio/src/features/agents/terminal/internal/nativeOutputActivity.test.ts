import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserRuntime, initializeStudioRuntime } from "../../../../runtime";
import { installDesktopGraphQlRuntime } from "../../../../test/desktopGraphQlRuntime";
import {
  desktopOutputActivity,
  reportNativeViewerAttached,
  type OutputActivityClient,
} from "./nativeOutputActivity";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("native terminal output reports", () => {
  it("submits the identity to the Rust observation mutation", async () => {
    const operations = installDesktopGraphQlRuntime();

    await desktopOutputActivity.report("run-1");

    // The `/api/terminals/viewers/output` route this used to post to belonged
    // to the retired Python terminal authority. Rust captures the pane and
    // decides whether output advanced, so the client submits one identity and
    // reaches no host route at all.
    expect(operations).toEqual([
      { operationName: "ObserveTerminalOutput", variables: { agentRunId: "run-1" } },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to observe without the desktop GraphQL runtime", async () => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));

    await expect(desktopOutputActivity.report("run-1")).rejects.toThrow(
      "Terminal output observation requires the desktop GraphQL runtime.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports once on attachment and never polls while the viewer idles", () => {
    vi.useFakeTimers();
    const client = stubClient();

    reportNativeViewerAttached(client, "run-1");

    // A stalled terminal must recover as soon as its viewer attaches, so the
    // one observation is never withheld.
    expect(client.report).toHaveBeenCalledTimes(1);
    expect(client.report).toHaveBeenCalledWith("run-1");

    // Studio has no output signal for a native viewer, so any repeat would be
    // an unconditional heartbeat costing a capture subprocess per tick. The
    // backend's live-session sweep observes from here.
    vi.advanceTimersByTime(60_000);
    expect(client.report).toHaveBeenCalledTimes(1);
  });

  it("keeps native rendering intact when the backend cannot record it", () => {
    const client = stubClient();
    client.report.mockRejectedValue(new Error("backend unavailable"));

    // Status telemetry may fail; native rendering must neither stop nor learn
    // about it.
    expect(() => reportNativeViewerAttached(client, "run-1")).not.toThrow();
    expect(client.report).toHaveBeenCalledTimes(1);
  });
});

function stubClient(): OutputActivityClient & {
  report: ReturnType<typeof vi.fn>;
} {
  return { report: vi.fn().mockResolvedValue(undefined) };
}
