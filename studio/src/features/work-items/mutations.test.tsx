import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  WorkTrackerModuleOpenDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "./generated/workItems.documents";
import { useSetWorkItemState } from "./mutations";

const moduleId = "module-1";

function issue(
  id: string,
  stateId: string,
  rank: string,
): GeneratedWorkTrackerWorkItemFieldsFragment {
  return {
    __typename: "WorktrackerIssue",
    id,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    state_id: stateId,
    description: "",
    workspace_tab_order: [],
    parent_id: moduleId,
    module_id: moduleId,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rank,
    issue_type_id: "story-type",
    project: null,
    state_record: null,
    issue_type_record: null,
    children: { nodes: [] },
    blocked_by_edges: { nodes: [] },
    blocks_edges: { nodes: [] },
  } as GeneratedWorkTrackerWorkItemFieldsFragment;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installTransport(execute: (request: string) => Promise<string>): void {
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({
    ...browser,
    graphQlTransport: () => ({
      graphql_execute: execute,
      graphql_subscribe: async () => "subscription",
      graphql_unsubscribe: async () => true,
    }),
  });
}

function seedModule(nodes: GeneratedWorkTrackerWorkItemFieldsFragment[]): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
    data: {
      module: { __typename: "WorktrackerIssueConnection", nodes: [] },
      work_items: { __typename: "WorktrackerIssueConnection", nodes },
    } as never,
  });
}

function cachedIssue(id: string) {
  return studioApolloClient().readFragment({
    id: studioApolloClient().cache.identify({ __typename: "WorktrackerIssue", id }),
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    optimistic: true,
  });
}

afterEach(async () => resetStudioApolloClient());

describe("human workflow transition", () => {
  it("updates destination state and arrival rank together while the mutation is pending", async () => {
    const mutationResponse = deferred<string>();
    const refetchResponse = deferred<string>();
    const requests: string[] = [];
    const moving = issue("moving", "doing", "kV");
    const authoritative = {
      ...moving,
      state_id: "ready",
      rank: "FV",
    };
    installTransport(async (request) => {
      requests.push(request);
      return requests.length === 1
        ? mutationResponse.promise
        : refetchResponse.promise;
    });
    seedModule([
      moving,
      issue("destination-first", "ready", "V"),
    ]);
    const hook = renderHook(() => useSetWorkItemState());

    let transition!: Promise<unknown>;
    act(() => {
      transition = hook.result.current.mutateAsync({
        id: moving.id,
        state: {
          id: "ready",
          name: "Ready",
          group: "unstarted",
          color: "#999999",
          sort_order: 1,
          is_protected: false,
        },
      });
    });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(cachedIssue(moving.id)).toMatchObject({
      state_id: "ready",
      rank: "FV",
    });

    mutationResponse.resolve(JSON.stringify({
      data: { update_work_item: authoritative },
    }));
    await waitFor(() => expect(requests).toHaveLength(2));
    refetchResponse.resolve(JSON.stringify({
      data: {
        module: { __typename: "WorktrackerIssueConnection", nodes: [] },
        work_items: {
          __typename: "WorktrackerIssueConnection",
          nodes: [
            authoritative,
            issue("destination-first", "ready", "V"),
          ],
        },
      },
    }));
    await act(async () => transition);

    const refreshed = studioApolloClient().readQuery({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId },
    });
    expect(refreshed?.work_items.nodes.map((item) => [item.id, item.rank])).toEqual([
      ["moving", "FV"],
      ["destination-first", "V"],
    ]);
  });
});
