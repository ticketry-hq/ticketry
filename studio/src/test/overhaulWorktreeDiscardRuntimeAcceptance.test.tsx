import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WorktreeBlock } from "../features/agents/worktrees";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const TASK = "60000000-0000-0000-0000-000000000001";

const absent = {
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

const live = {
  ...absent,
  kind: "worktree",
  branch: "wt/CODIN-881-parent-story",
  base_branch: "main",
  path: "/checkouts/ticketry/CODIN-881-parent-story",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 0,
  behind: 0,
  conflict: false,
  checkout_present: true,
};

/// What Rust answers a discard with: whether it removed the checkout, and the
/// authoritative status of the Work Item afterwards.
const discarded = {
  removed: true,
  task_id: TASK,
  top_level_task_id: TASK,
  branch: "wt/CODIN-881-parent-story",
  reason: null,
  status: absent,
};

interface Request {
  operationName: string;
  variables: Record<string, unknown>;
}

async function installDesktopRuntime(requests: Request[]) {
  const graphqlExecute = vi.fn(async (requestJson: string) => {
    const request = JSON.parse(requestJson) as Request;
    requests.push(request);
    if (request.operationName === "WorktreeStatus") {
      return JSON.stringify({ data: { worktree_status: live } });
    }
    if (request.operationName === "WorktreeDiscard") {
      return JSON.stringify({ data: { worktree_discard: discarded } });
    }
    throw new Error(`Unexpected operation ${request.operationName}`);
  });
  initializeStudioRuntime(
    await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
      }) as never,
    }),
  );
}

describe("worktree discard desktop runtime acceptance", () => {
  it("[overhaul-90] throws a checkout away only after an explicit confirmation, by identity alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const requests: Request[] = [];
    await installDesktopRuntime(requests);

    render(<WorktreeBlock taskId={TASK} moduleId="m1" ticketSeq={881} />);

    // The first click asks; nothing has been sent yet.
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(
      screen.getByText("Discard — work is thrown away?"),
    ).toBeTruthy();
    expect(
      requests.some((request) => request.operationName === "WorktreeDiscard"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Yes, discard" }));

    // The mutation's own response is the authority for the window that asked:
    // the block renders the absent state without a follow-up status read.
    expect(
      await screen.findByRole("button", { name: "+ Create worktree" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Discard" })).toBeNull(),
    );

    // Studio submits two identities and nothing else — no path, branch,
    // repository, or force scope — and no legacy host route is consulted.
    const sent = requests.filter(
      (request) => request.operationName === "WorktreeDiscard",
    );
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0].variables).sort()).toEqual([
      "operationId",
      "taskId",
    ]);
    expect(sent[0].variables.taskId).toBe(TASK);
    expect(typeof sent[0].variables.operationId).toBe("string");
    expect(sent[0].variables.operationId).not.toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[overhaul-91] cancelling the confirmation sends nothing at all", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const requests: Request[] = [];
    await installDesktopRuntime(requests);

    render(<WorktreeBlock taskId={TASK} moduleId="m1" ticketSeq={881} />);

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await screen.findByRole("button", { name: "Discard" });
    expect(
      requests.filter(
        (request) => request.operationName === "WorktreeDiscard",
      ),
    ).toHaveLength(0);
    // The checkout is still what the block shows.
    expect(screen.getByText("wt/CODIN-881-parent-story → main")).toBeTruthy();
  });
});
