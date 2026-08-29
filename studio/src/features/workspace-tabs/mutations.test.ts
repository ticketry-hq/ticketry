import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { studioApolloClient, resetStudioApolloClient } from "../../shared/apollo/client";
import { GeneratedWorkTrackerWorkItemFieldsFragmentDoc } from "../work-items";
import { saveWorkspaceTabOrder } from "./mutations";
import type { WorkspaceTabIdentity } from "./types";

const WORK_ITEM_ID = "11111111111111111111111111111111";

function issue(order: readonly WorkspaceTabIdentity[]) {
  return {
    __typename: "WorktrackerIssue",
    id: WORK_ITEM_ID,
    name: "Workspace order",
    description: "",
    rank: "a",
    project_id: "22222222222222222222222222222222",
    sequence_id: 1,
    state_id: null,
    workspace_tab_order: order,
    parent_id: null,
    module_id: "33333333333333333333333333333333",
    is_archived: false,
    created_at: "2026-08-29T00:00:00Z",
    updated_at: "2026-08-29T00:00:00Z",
    issue_type_id: "44444444444444444444444444444444",
    project: {
      __typename: "WorktrackerProject",
      id: "22222222222222222222222222222222",
      slug: "CODING",
    },
    state_record: null,
    issue_type_record: {
      __typename: "WorktrackerIssuetype",
      id: "44444444444444444444444444444444",
      name: "Story",
      level: "task",
      color: "",
      sort_order: 1,
    },
    children: { __typename: "WorktrackerIssueConnection", nodes: [] },
    blocked_by_edges: {
      __typename: "WorktrackerIssueBlockedByConnection",
      nodes: [],
    },
    blocks_edges: {
      __typename: "WorktrackerIssueBlockedByConnection",
      nodes: [],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installTransport(
  execute: (request: string) => Promise<string>,
): void {
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({
    ...browser,
    graphQlTransport: () => ({
      graphql_execute: execute,
      graphql_subscribe: async () => "subscription",
      graphql_unsubscribe: async () => true,
    }),
  });
  const client = studioApolloClient();
  client.writeFragment({
    id: client.cache.identify({ __typename: "WorktrackerIssue", id: WORK_ITEM_ID }),
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    data: issue([{ kind: "details" }]) as never,
  });
}

function cachedOrder(): unknown {
  return studioApolloClient().readFragment({
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    from: { __typename: "WorktrackerIssue", id: WORK_ITEM_ID },
    optimistic: true,
  })?.workspace_tab_order;
}

afterEach(async () => resetStudioApolloClient());

describe("Apollo workspace tab saves", () => {
  it("shows an optimistic order and rolls it back when the save fails", async () => {
    const response = deferred<string>();
    const requests: string[] = [];
    installTransport(async (request) => {
      requests.push(request);
      return response.promise;
    });

    const next: WorkspaceTabIdentity[] = [
      { kind: "doc", id: "design" },
      { kind: "details" },
    ];
    const saving = saveWorkspaceTabOrder(WORK_ITEM_ID, next);

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(cachedOrder()).toEqual(next);
    response.resolve(JSON.stringify({
      errors: [{ message: "save failed", extensions: { code: "validation" } }],
    }));

    await expect(saving).rejects.toThrow("save failed");
    expect(cachedOrder()).toEqual([{ kind: "details" }]);
  });

  it("serializes saves for the same WorkItem", async () => {
    const responses = [deferred<string>(), deferred<string>()];
    const requests: Array<{ variables: Record<string, unknown> }> = [];
    installTransport(async (request) => {
      requests.push(JSON.parse(request));
      return responses[requests.length - 1].promise;
    });
    const first = [{ kind: "details" as const }, { kind: "doc" as const, id: "one" }];
    const second = [{ kind: "doc" as const, id: "one" }, { kind: "details" as const }];

    const firstSave = saveWorkspaceTabOrder(WORK_ITEM_ID, first);
    const secondSave = saveWorkspaceTabOrder(WORK_ITEM_ID, second);
    await waitFor(() => expect(requests).toHaveLength(1));

    responses[0].resolve(JSON.stringify({
      data: { update_work_item: issue(first) },
    }));
    await firstSave;
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].variables.workspaceTabOrder).toEqual(first);
    expect(requests[1].variables.workspaceTabOrder).toEqual(second);

    responses[1].resolve(JSON.stringify({
      data: { update_work_item: issue(second) },
    }));
    await secondSave;
    expect(cachedOrder()).toEqual(second);
  });
});
