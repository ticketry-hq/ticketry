import { describe, expect, it, vi } from "vitest";

import {
  completeDirectories,
  documentUrl,
  listScratchDocuments,
  listTaskDocuments,
  newSaveOperationId,
  saveDocument,
} from "../features/documents";
import { requestWorktreeCreate, newOperationId } from "../features/agents/worktrees/internal/createTransport";
import { requestWorktreeDiscard } from "../features/agents/worktrees/internal/discardTransport";
import { readWorktreeStatus } from "../features/agents/worktrees/internal/statusTransport";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

/**
 * The Slice 4 cutover, observed from Studio.
 *
 * Every workspace capability Studio has — document registries, saves,
 * directory completion, asset URLs, worktree status, creation, and discard —
 * used to reach the Django host over `/api/documents`, `/api/docs`,
 * `/api/fs/complete`, or `/api/worktrees`. After the handoff, production Studio
 * reaches exactly two places: the in-process GraphQL runtime over TauRPC, and
 * the read-only desktop document protocol.
 *
 * That is what this file proves, and it proves it the only way that stays true
 * as the features change: by running the real feature functions against the real
 * desktop runtime with `fetch` replaced by a recorder. A legacy call is not
 * merely unexpected here — it is a failure, because after the cutover there is
 * no Django writer on the other end of it.
 */

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const TASK = "70000000-0000-0000-0000-000000000001";
const MODULE = "70000000-0000-0000-0000-0000000000a1";

/** Every legacy host path this slice retired from production Studio. */
const RETIRED_ROUTES = [
  "/api/documents",
  "/api/docs",
  "/api/fs/complete",
  "/api/worktrees",
  "/api/terminals",
];

const absentWorktree = {
  kind: "none",
  task_id: TASK,
  top_level_task_id: TASK,
  is_shared: false,
  branch: null,
  base_branch: null,
  path: null,
  state: null,
  clean: null,
  dirty: null,
  ahead: null,
  behind: null,
  conflict: null,
  checkout_present: null,
  ephemeral: false,
  reason: null,
};

const liveWorktree = {
  ...absentWorktree,
  kind: "worktree",
  branch: "wt/CODIN-766-cut-over",
  base_branch: "main",
  path: "/checkouts/ticketry/CODIN-766-cut-over",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 0,
  behind: 0,
  conflict: false,
  checkout_present: true,
};

const documentRow = {
  id: "doc-1",
  relPath: "SPEC.md",
  contentDigest: "a".repeat(64),
};

interface GraphQlRequest {
  operationName: string;
  variables: Record<string, unknown>;
}

/** Answer every operation this slice owns, and refuse anything unrecognised. */
function answer(request: GraphQlRequest): string {
  switch (request.operationName) {
    case "RefreshTaskDocumentRegistry":
      return JSON.stringify({
        data: { refresh_task_document_registry: [documentRow] },
      });
    case "RefreshScratchDocumentRegistry":
      return JSON.stringify({
        data: { refresh_scratch_document_registry: [documentRow] },
      });
    case "CompleteDirectories":
      return JSON.stringify({ data: { directory_completions: ["/repos/ticketry"] } });
    case "SaveDesignDocument":
      return JSON.stringify({
        data: {
          save_design_document: {
            digest: "b".repeat(64),
            saved: true,
            stale: false,
          },
        },
      });
    case "WorktreeStatus":
      return JSON.stringify({ data: { worktree_status: liveWorktree } });
    case "WorktreeCreate":
      return JSON.stringify({ data: { worktree_create: liveWorktree } });
    case "WorktreeDiscard":
      return JSON.stringify({
        data: {
          worktree_discard: {
            removed: true,
            task_id: TASK,
            top_level_task_id: TASK,
            branch: liveWorktree.branch,
            reason: null,
            status: absentWorktree,
          },
        },
      });
    default:
      throw new Error(`Unexpected operation ${request.operationName}`);
  }
}

async function installProductionRuntime() {
  const operations: string[] = [];
  const fetchMock = vi.fn(() => {
    throw new Error("production Studio must not open an HTTP connection here");
  });
  vi.stubGlobal("fetch", fetchMock);
  initializeStudioRuntime(
    await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: async (requestJson: string) => {
          const request = JSON.parse(requestJson) as GraphQlRequest;
          operations.push(request.operationName);
          return answer(request);
        },
        graphql_subscribe: vi.fn(),
      }) as never,
    }),
  );
  return { operations, fetchMock };
}

describe("workspace cutover desktop runtime acceptance", () => {
  it("[overhaul-97] routes every production document and worktree call through the in-process runtime, and none through a retired host route", async () => {
    const { operations, fetchMock } = await installProductionRuntime();

    await expect(listTaskDocuments(TASK, "p1", MODULE)).resolves.toEqual([
      { id: "doc-1", rel_path: "SPEC.md", label: "SPEC", content_digest: documentRow.contentDigest },
    ]);
    await expect(listScratchDocuments(MODULE)).resolves.toHaveLength(1);
    await expect(completeDirectories("/repos/tick")).resolves.toEqual([
      "/repos/ticketry",
    ]);
    await expect(
      saveDocument({
        documentId: "doc-1",
        expectedDigest: documentRow.contentDigest,
        content: "# Spec\n",
        operationId: newSaveOperationId(),
      }),
    ).resolves.toMatchObject({ saved: true, stale: false });
    await expect(readWorktreeStatus(TASK)).resolves.toMatchObject({
      kind: "worktree",
    });
    await expect(
      requestWorktreeCreate(TASK, newOperationId()),
    ).resolves.toMatchObject({ kind: "worktree", branch: liveWorktree.branch });
    await expect(
      requestWorktreeDiscard(TASK, newOperationId()),
    ).resolves.toMatchObject({ removed: true });
    // Every capability answered, and each one answered through GraphQL.
    expect(operations).toEqual([
      "RefreshTaskDocumentRegistry",
      "RefreshScratchDocumentRegistry",
      "CompleteDirectories",
      "SaveDesignDocument",
      "WorktreeStatus",
      "WorktreeCreate",
      "WorktreeDiscard",
    ]);
    // Not "no legacy route was called" but "no HTTP request happened at all":
    // the weaker claim would pass a runtime that had quietly moved a legacy
    // route to another path.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[overhaul-98] serves document and asset bytes from the desktop protocol rather than the retired host route", async () => {
    await installProductionRuntime();

    // The URL an iframe navigates to, and the origin its own relative assets
    // resolve against. Its directory levels are preserved for exactly that
    // reason, so a nested document's `./diagram.png` still lands beside it.
    const url = documentUrl("doc 1", "design/HLD.html");

    expect(url).toBe("ticketrydoc://localhost/doc%201/design/HLD.html");
    for (const route of RETIRED_ROUTES) {
      expect(url).not.toContain(route);
    }
  });
});
