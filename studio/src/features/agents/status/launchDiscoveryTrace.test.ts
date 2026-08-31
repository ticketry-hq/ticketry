import { describe, expect, it, vi } from "vitest";

import { createLaunchDiscoveryRecorder } from "./launchDiscoveryTrace";

describe("launch discovery trace", () => {
  it("records the complete correlation identity at the diagnostic seam", () => {
    const write = vi.fn();
    const recorder = createLaunchDiscoveryRecorder({
      rendererInstance: "renderer-1",
      runtimeInstance: "runtime-1",
      now: () => "2026-08-31T08:30:00.000Z",
      write,
    });

    recorder.record(
      "graphql-frame-received",
      {
        projectId: "project-1",
        agentRunId: "run-1",
        cursor: 42,
        connectionGeneration: 3,
      },
      { deliveryPath: "safety_reread" },
    );

    expect(write).toHaveBeenCalledWith("[launch-discovery]", {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:30:00.000Z",
      projectId: "project-1",
      agentRunId: "run-1",
      cursor: 42,
      connectionGeneration: 3,
      rendererInstance: "renderer-1",
      runtimeInstance: "runtime-1",
      deliveryPath: "safety_reread",
    });
  });

  it("keeps unavailable correlation fields explicit", () => {
    const write = vi.fn();
    const recorder = createLaunchDiscoveryRecorder({
      rendererInstance: "renderer-2",
      runtimeInstance: null,
      now: () => "2026-08-31T08:31:00.000Z",
      write,
    });

    recorder.record("subscription-started", {
      projectId: "project-1",
      agentRunId: null,
      cursor: null,
      connectionGeneration: 1,
    });

    expect(write.mock.calls[0][1]).toMatchObject({
      agentRunId: null,
      cursor: null,
      runtimeInstance: null,
    });
  });

  it("carries a discovered run identity into its committed workspace render", () => {
    const write = vi.fn();
    const recorder = createLaunchDiscoveryRecorder({
      rendererInstance: "renderer-1",
      runtimeInstance: "runtime-1",
      now: () => "2026-08-31T08:32:00.000Z",
      write,
    });
    recorder.record("apollo-run-applied", {
      projectId: "project-1",
      agentRunId: "run-1",
      cursor: 42,
      connectionGeneration: 3,
    });

    recorder.recordForAgentRun(
      "workspace-render-committed",
      "project-1",
      "run-1",
      { bucket: "task-1" },
    );

    expect(write).toHaveBeenLastCalledWith("[launch-discovery]", {
      event: "workspace-render-committed",
      timestamp: "2026-08-31T08:32:00.000Z",
      projectId: "project-1",
      agentRunId: "run-1",
      cursor: 42,
      connectionGeneration: 3,
      rendererInstance: "renderer-1",
      runtimeInstance: "runtime-1",
      bucket: "task-1",
    });
  });
});
