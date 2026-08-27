import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gql } from "@apollo/client";

import DocViewer from "../app/shell/ticket-workspace/selected-ticket/documents/DocViewer";
import {
  listScratchDocuments,
  listTaskDocuments,
  type DesignDoc,
} from "../features/documents";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { studioApolloClient } from "../shared/apollo/client";

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

/// The generated model rows the runtime returns: an identity and a relative
/// path, and deliberately no absolute root, no provenance, and no label.
const taskRows = [
  { __typename: "DesignDocuments", id: "doc-spec", relPath: "SPEC.MD", contentDigest: "digest-spec" },
  { __typename: "DesignDocuments", id: "doc-design", relPath: "notes/Design.HTML", contentDigest: null },
];

async function desktopStudio(): Promise<{ operations: string[] }> {
  const operations: string[] = [];
  const graphql_execute = vi.fn(async (encoded: string) => {
    const request = JSON.parse(encoded) as {
      operationName: string;
      variables: Record<string, unknown>;
    };
    operations.push(request.operationName);
    if (request.operationName === "RefreshTaskDocumentRegistry") {
      expect(request.variables).toEqual({
        taskId: "task-1",
        projectId: "project-1",
        moduleId: "module-1",
      });
      return JSON.stringify({
        data: { refresh_task_document_registry: taskRows },
      });
    }
    expect(request.operationName).toBe("RefreshScratchDocumentRegistry");
    expect(request.variables).toEqual({ moduleId: "module-1" });
    return JSON.stringify({
      data: {
        refresh_scratch_document_registry: [
          { __typename: "DesignDocuments", id: "doc-plan", relPath: "Plan.md", contentDigest: "digest-plan" },
        ],
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
  return { operations };
}

describe("document registry desktop runtime acceptance", () => {
  afterEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("[overhaul-86] lists documents from generated GraphQL rows and renders them from the desktop document protocol", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# Discovered\n\n<script>alert('no')</script>", {
        headers: { ETag: '"digest-1"' },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { operations } = await desktopStudio();

    // The registry is a reconciliation over the in-process runtime, and the
    // labels Studio renders come from the relative path rather than the wire.
    const documents = await listTaskDocuments("task-1", "project-1", "module-1");
    const scratch = await listScratchDocuments("module-1");

    // The content digest travels with the row so an open viewer can tell a
    // refreshed registry that changed from one that merely reloaded.
    expect(documents).toEqual<DesignDoc[]>([
      {
        id: "doc-spec",
        rel_path: "SPEC.MD",
        label: "SPEC",
        content_digest: "digest-spec",
      },
      {
        id: "doc-design",
        rel_path: "notes/Design.HTML",
        label: "Design",
        content_digest: null,
      },
    ]);
    expect(scratch).toEqual<DesignDoc[]>([
      {
        id: "doc-plan",
        rel_path: "Plan.md",
        label: "Plan",
        content_digest: "digest-plan",
      },
    ]);
    expect(operations).toEqual([
      "RefreshTaskDocumentRegistry",
      "RefreshScratchDocumentRegistry",
    ]);
    expect(studioApolloClient().readFragment({
      id: studioApolloClient().cache.identify({
        __typename: "DesignDocuments",
        id: "doc-spec",
      }),
      fragment: gql`
        fragment CachedDocumentRegistryRow on DesignDocuments {
          id
          relPath
          contentDigest
        }
      `,
    })).toEqual({
      __typename: "DesignDocuments",
      id: "doc-spec",
      relPath: "SPEC.MD",
      contentDigest: "digest-spec",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // HTML keeps its sandboxed frame, now pointed at the desktop protocol so
    // its own relative assets resolve under the same document prefix.
    render(<DocViewer doc={documents[1]} />);
    const frame = await screen.findByTestId("workspace-doc-frame");
    expect(frame).toHaveAttribute(
      "src",
      "ticketrydoc://localhost/doc-design/notes/Design.HTML",
    );
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");

    // Markdown still arrives over the same URL, sanitized before it renders.
    render(<DocViewer doc={documents[0]} />);
    expect(await screen.findByRole("heading", { name: "Discovered" }))
      .toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "ticketrydoc://localhost/doc-spec/SPEC.MD",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
  });
});
