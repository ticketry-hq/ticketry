import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceDocuments } from ".";
import { initializeStudioRuntime } from "../../runtime";
import { createBrowserRuntime } from "../../runtime/browserRuntime";
import { createDesktopRuntime } from "../../runtime/desktopRuntime";

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const notesRow = {
  __typename: "DesignDocuments",
  id: "doc-notes",
  relPath: "NOTES.md",
  contentDigest: "digest-notes",
};

/// Answers task registry refreshes from the network boundary; while
/// `failRefresh` is set every refresh is refused as a transport error.
async function desktopRegistry(): Promise<{ failRefresh: { value: boolean }; refreshes: string[] }> {
  const failRefresh = { value: false };
  const refreshes: string[] = [];
  const graphql_execute = vi.fn(async (encoded: string) => {
    const request = JSON.parse(encoded) as {
      operationName: string;
      variables: { taskId: string };
    };
    expect(request.operationName).toBe("RefreshTaskDocumentRegistry");
    refreshes.push(request.variables.taskId);
    if (failRefresh.value) throw new Error("network aborted");
    return JSON.stringify({
      data: {
        refresh_task_document_registry: request.variables.taskId === "story-a"
          ? [notesRow]
          : [],
      },
    });
  });
  initializeStudioRuntime(await createDesktopRuntime({
    invoke: vi.fn().mockResolvedValue(startup),
    createGraphQlProxy: () => ({
      graphql_execute,
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  }));
  return { failRefresh, refreshes };
}

describe("workspace documents when a registry refresh fails", () => {
  afterEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    vi.restoreAllMocks();
  });

  it("keeps known documents on Story reentry without treating the failure as authoritative", async () => {
    const { failRefresh, refreshes } = await desktopRegistry();
    const { result, rerender } = renderHook(
      ({ bucket }) => useWorkspaceDocuments(bucket, "project-1", "module-1", false),
      { initialProps: { bucket: "story-a" } },
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.documents.map((doc) => doc.rel_path)).toEqual(["NOTES.md"]);

    failRefresh.value = true;
    rerender({ bucket: "story-b" });
    rerender({ bucket: "story-a" });
    await waitFor(() => expect(refreshes).toEqual(["story-a", "story-b", "story-a"]));

    // A refused refresh proves nothing about absence: the known tab stays,
    // and the registry is not reported as fetched, so nothing is pruned.
    await waitFor(() => {
      expect(result.current.documents.map((doc) => doc.rel_path)).toEqual(["NOTES.md"]);
    });
    expect(result.current.isFetched).toBe(false);

    // Only a later successful read makes the registry authoritative again.
    failRefresh.value = false;
    rerender({ bucket: "story-b" });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.documents).toEqual([]);
    rerender({ bucket: "story-a" });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.documents.map((doc) => doc.rel_path)).toEqual(["NOTES.md"]);
  });
});
