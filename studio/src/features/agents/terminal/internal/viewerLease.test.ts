import { describe, expect, it, vi } from "vitest";

import { initializeStudioRuntime, type StudioRuntime } from "../../../../runtime";
import { documentOperationName } from "../../../../graphql-foundation/typedDocument";
import { desktopViewerLease } from "./viewerLease";

function desktopRuntime(
  writeWorkTracker: StudioRuntime["writeWorkTracker"],
): StudioRuntime {
  return {
    platform: "desktop",
    graphQlTransport: () => { throw new Error("not used"); },
    capabilities: {
      statusFeed: true,
      nativeLifecycle: true,
      serviceSupervision: true,
      nativeTerminal: true,
      nativeFolderPicker: true,
      appUpdates: true,
    },
    appUpdates: {
      check: async () => ({ installedVersion: "0.0.0", status: "current" }),
    },
    readWorkTracker: writeWorkTracker,
    writeWorkTracker,
    readSettings: writeWorkTracker,
    writeSettings: writeWorkTracker,
    statusStream: () => null,
    documentUrl: (id, path) => `ticketrydoc://localhost/${id}/${path}`,
    pickFolder: async () => null,
    retryServices: async () => {},
    startup: () => ({
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
  };
}

describe("desktop viewer lease GraphQL transport", () => {
  it("keeps one generation across acquire, renew, and release", async () => {
    const execute = vi.fn(async (
      document: { operationName: string },
      _variables: unknown,
    ) => ({
      viewer_lease: documentOperationName(document) === "DeleteViewerLease"
        ? null
        : {
            agent_run_id: "run-1",
            viewer_id: "viewer-1",
            transport: "native",
            generation: "generation-1",
            acquired_at: "2026-08-19T10:00:00Z",
            expires_at: "2026-08-19T10:00:30Z",
          },
    }));
    initializeStudioRuntime(
      desktopRuntime((routes) => routes.graphQl(execute as never)),
    );

    const lease = await desktopViewerLease.acquire("run-1", "viewer-1", "native");
    await desktopViewerLease.renew("run-1", "viewer-1", lease.generation);
    await desktopViewerLease.release("run-1", "viewer-1", lease.generation);

    expect(execute.mock.calls.map(([document]) => documentOperationName(document))).toEqual([
      "CreateViewerLease",
      "UpdateViewerLease",
      "DeleteViewerLease",
    ]);
    expect(execute.mock.calls.map(([, variables]) => variables)).toEqual([
      { agentRunId: "run-1", viewerId: "viewer-1", transport: "native" },
      { agentRunId: "run-1", viewerId: "viewer-1", generation: "generation-1" },
      { agentRunId: "run-1", viewerId: "viewer-1", generation: "generation-1" },
    ]);
  });
});
