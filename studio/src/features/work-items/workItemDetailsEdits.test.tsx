import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../../shared/api/errors";
import type { IssueType } from "../../shared/api/types";
import { resetStudioApolloClient } from "../../shared/apollo/client";
import { mutationFailurePhase } from "../../shared/apollo/declaredMutation";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import { cachedIssue, issueRow, seedModule } from "../../test/workItemCacheFixtures";
import {
  useChangeWorkItemType,
  useEditWorkItemDescription,
  useRenameWorkItem,
} from "./mutations";
import { updateWorkItem } from "./mutationTransport";
import { consumeLocalWorkItemConvergence } from "./workItemConvergence";

afterEach(async () => resetStudioApolloClient());

const bug: IssueType = {
  id: "type-bug",
  name: "Bug",
  level: "task",
  color: "#f00",
  sort_order: 2,
} as IssueType;

const edits = [
  {
    edit: "rename",
    hook: useRenameWorkItem,
    args: { id: "item-1", name: "Renamed" },
    variables: { id: "item-1", name: "Renamed" },
    optimistic: { name: "Renamed" },
    authoritative: { name: "Renamed by server" },
  },
  {
    edit: "description",
    hook: useEditWorkItemDescription,
    args: { id: "item-1", description: null },
    variables: { id: "item-1", description: null },
    optimistic: { description: "" },
    authoritative: { description: "" },
  },
  {
    edit: "type change",
    hook: useChangeWorkItemType,
    args: { id: "item-1", issueType: bug },
    variables: { id: "item-1", issueTypeId: "type-bug" },
    optimistic: {
      issue_type_id: "type-bug",
      issue_type_record: { id: "type-bug", name: "Bug", level: "task", color: "#f00", sort_order: 2 },
    },
    authoritative: { issue_type_id: "type-bug" },
  },
] as const;

const before = issueRow("item-1", {
  name: "Before",
  description: "Original",
  issue_type_id: "type-1",
  issue_type_record: {
    __typename: "WorktrackerIssuetype",
    id: "type-1",
    name: "Story",
    level: "task",
    color: "",
    sort_order: 1,
  },
} as never);

describe.each(edits)("work-item $edit", ({ hook, args, variables, optimistic, authoritative }) => {
  it("shows the edit while pending and adopts the authoritative row", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [before]);
    const server = issueRow("item-1", {
      ...before,
      ...authoritative,
      state_revision: 2,
      updated_at: "2026-10-02T00:00:00Z",
    } as never);
    const write = transport.holdNext("UpdateWorkTrackerWorkItemDetails");
    const mutation = renderHook(() => hook());

    let pending!: Promise<unknown>;
    act(() => {
      pending = mutation.result.current.mutateAsync(args as never);
    });
    const request = await write.reached;
    expect(request.variables).toEqual(variables);
    expect(cachedIssue("item-1", true)).toMatchObject(optimistic);
    expect(mutation.result.current.isPending).toBe(true);

    write.answer({ update_work_item: server });
    await act(async () => {
      await expect(pending).resolves.toMatchObject({ id: "item-1" });
    });

    expect(cachedIssue("item-1")).toMatchObject(authoritative);
    expect(transport.operationNames()).toEqual(["UpdateWorkTrackerWorkItemDetails"]);
    expect(consumeLocalWorkItemConvergence("item-1", "2026-10-02T00:00:00Z")).toBe(true);
    expect(mutation.result.current).toMatchObject({ isPending: false, isSuccess: true });
  });

  it("rolls back on failure and rejects with the mapped ApiError status", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [before]);
    transport.failNext("UpdateWorkTrackerWorkItemDetails", "field_validation", "Invalid field");
    const mutation = renderHook(() => hook());

    let failure: unknown;
    await act(async () => {
      failure = await mutation.result.current.mutateAsync(args as never)
        .catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 422,
      body: { code: "field_validation", detail: "Invalid field" },
    });
    expect(mutationFailurePhase(failure)).toBe("write");
    expect(cachedIssue("item-1", true)).toMatchObject({
      name: "Before",
      description: "Original",
      issue_type_id: "type-1",
    });
    expect(mutation.result.current.error).toBe(failure);
  });
});

describe("updateWorkItem entry point", () => {
  it("keeps its signature and maps a missing work item to a 404 ApiError", async () => {
    const transport = installScriptedGraphQlTransport();
    transport.failNext("UpdateWorkTrackerWorkItemDetails", "not_found", "Not found");

    const failure = await updateWorkItem("item-1", { name: "Renamed" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404 });
    expect(transport.requests).toEqual([{
      operationName: "UpdateWorkTrackerWorkItemDetails",
      variables: { id: "item-1", name: "Renamed" },
    }]);
  });
});
