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

/// What Rust answers a creation with: the authoritative live status of the
/// checkout that now exists, derived entirely from the submitted identity.
const created = {
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

interface Request {
  operationName: string;
  variables: Record<string, unknown>;
}

async function installDesktopRuntime(requests: Request[]) {
  const graphqlExecute = vi.fn(async (requestJson: string) => {
    const request = JSON.parse(requestJson) as Request;
    requests.push(request);
    if (request.operationName === "WorktreeStatus") {
      const answered = requests.some(
        (earlier) => earlier.operationName === "WorktreeCreate",
      );
      return JSON.stringify({
        data: { worktree_status: answered ? created : absent },
      });
    }
    if (request.operationName === "WorktreeCreate") {
      return JSON.stringify({ data: { worktree_create: created } });
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

describe("worktree creation desktop runtime acceptance", () => {
  it("[overhaul-88] opts a task into a worktree by identity alone and renders the authoritative result", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const requests: Request[] = [];
    await installDesktopRuntime(requests);

    render(
      <WorktreeBlock
        taskId={TASK}
        parentId={null}
        moduleId="m1"
        projectId="p1"
        ticketSeq={881}
        taskName="Parent story"
      />,
    );

    const create = await screen.findByRole("button", {
      name: "+ Create worktree",
    });
    fireEvent.click(create);

    // The mutation's own response is the authority for the window that asked:
    // the block renders the live checkout without a follow-up status read.
    expect(
      await screen.findByText("wt/CODIN-881-parent-story → main"),
    ).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "+ Create worktree" }),
      ).toBeNull(),
    );

    // Studio submits two identities and nothing else — no parent, module,
    // project, ticket sequence, or name is trusted as authority — and no
    // legacy host route is consulted.
    const create_ = requests.filter(
      (request) => request.operationName === "WorktreeCreate",
    );
    expect(create_).toHaveLength(1);
    expect(Object.keys(create_[0].variables).sort()).toEqual([
      "operationId",
      "taskId",
    ]);
    expect(create_[0].variables.taskId).toBe(TASK);
    expect(typeof create_[0].variables.operationId).toBe("string");
    expect(create_[0].variables.operationId).not.toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[overhaul-89] reuses one operation identity for the retries of one intent", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const requests: Request[] = [];
    await installDesktopRuntime(requests);

    const first = render(
      <WorktreeBlock taskId={TASK} moduleId="m1" ticketSeq={881} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Create worktree" }),
    );
    await screen.findByText("wt/CODIN-881-parent-story → main");
    first.unmount();

    render(<WorktreeBlock taskId={TASK} moduleId="m1" ticketSeq={881} />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "+ Create worktree" }),
      ).toBeNull(),
    );

    const identities = requests
      .filter((request) => request.operationName === "WorktreeCreate")
      .map((request) => request.variables.operationId);
    expect(identities).toHaveLength(1);
    // A second intent would mint its own identity; this one never re-asks,
    // because the worktree it created is already the answer.
    expect(new Set(identities).size).toBe(identities.length);
  });
});
