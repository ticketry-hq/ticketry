import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WorktreeBlock } from "../features/agents/worktrees";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";
import { studioApolloClient } from "../shared/apollo/client";
import { WorktreeStatusDocument } from "../features/agents/worktrees/generated/worktreeStatus.documents";

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const PARENT = "60000000-0000-0000-0000-000000000001";
const CHILD = "60000000-0000-0000-0000-000000000002";

const answers: Record<string, Record<string, unknown>> = {
  [PARENT]: {
    __typename: "WorktreeStatusView",
    kind: "worktree",
    task_id: PARENT,
    top_level_task_id: PARENT,
    is_shared: false,
    branch: "wt/CODIN-881-parent-story",
    base_branch: "main",
    path: "/checkouts/CODIN-881-parent-story",
    state: "active",
    clean: false,
    dirty: true,
    ahead: 2,
    behind: 1,
    conflict: false,
    checkout_present: true,
    ephemeral: false,
    reason: null,
  },
  [CHILD]: {
    __typename: "WorktreeStatusView",
    kind: "no_repo",
    task_id: CHILD,
    top_level_task_id: CHILD,
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
    reason: "no local folder is configured for this module",
  },
};

async function installDesktopRuntime(
  requests: { operationName: string; variables: Record<string, unknown> }[],
) {
  const graphqlExecute = vi.fn(async (requestJson: string) => {
    const request = JSON.parse(requestJson) as {
      operationName: string;
      variables: { taskId: string };
    };
    requests.push(request);
    if (request.operationName !== "WorktreeStatus") {
      throw new Error(`Unexpected operation ${request.operationName}`);
    }
    return JSON.stringify({
      data: { worktree_status: answers[request.variables.taskId] },
    });
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

describe("worktree status desktop runtime acceptance", () => {
  it("[overhaul-85] renders live worktree state and typed absence from the Rust status query alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const requests: { operationName: string; variables: Record<string, unknown> }[] = [];
    await installDesktopRuntime(requests);

    const live = render(
      <WorktreeBlock
        taskId={PARENT}
        parentId={null}
        moduleId="m1"
      />,
    );

    expect(
      await screen.findByText("wt/CODIN-881-parent-story"),
    ).toBeTruthy();
    expect(screen.getByText("↑2 ↓1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show worktree details" }));
    await screen.findByTestId("worktree-details");
    expect(screen.getByText("Dirty")).toBeTruthy();
    expect(screen.getByText("↑2 ↓1 vs main")).toBeTruthy();
    live.unmount();

    render(
      <WorktreeBlock
        taskId={CHILD}
        parentId={PARENT}
        moduleId="m2"
      />,
    );

    // Once the typed absence is cached, the block renders nothing at all.
    await waitFor(() =>
      expect(studioApolloClient().readQuery({
        query: WorktreeStatusDocument,
        variables: { taskId: CHILD },
      })?.worktree_status).toMatchObject({ kind: "no_repo" }),
    );
    expect(screen.queryByTestId("worktree-block")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "+ Worktree" }),
    ).toBeNull();

    // The runtime derives ownership itself: only the identity is submitted,
    // and no legacy host route is consulted.
    // The catalog read scopes worktree trust to the activated providers
    // (CODING-2137); it is not a worktree route.
    const worktreeRequests = requests.filter(
      (request) => request.operationName === "WorktreeStatus",
    );
    expect(requests.map((request) => request.operationName)).toEqual([
      "WorktreeStatus",
      "LoadProviderCatalog",
      "WorktreeStatus",
    ]);
    expect(worktreeRequests.map((request) => request.variables)).toEqual([
      { taskId: PARENT },
      { taskId: CHILD },
    ]);
    expect(studioApolloClient().readQuery({
      query: WorktreeStatusDocument,
      variables: { taskId: CHILD },
    })?.worktree_status).toMatchObject({
      task_id: CHILD,
      kind: "no_repo",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
