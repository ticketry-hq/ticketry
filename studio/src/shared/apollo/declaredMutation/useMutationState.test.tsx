import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UpdateWorkTrackerWorkItemDetailsDocument } from "../../../features/work-items/generated/workItems.documents";
import { installScriptedGraphQlTransport } from "../../../test/scriptedGraphQlTransport";
import {
  WorkTrackerModuleOpenDocument,
  cachedIssue,
  cachedModuleIds,
  deferred,
  issueRow,
  moduleOpenData,
  seedModule,
} from "../../../test/workItemCacheFixtures";
import { ApiError } from "../../api/errors";
import { resetStudioApolloClient, studioApolloClient } from "../client";
import { declareMutation, mutationFailurePhase, refreshRead } from ".";
import { useDeclaredMutation } from "./useDeclaredMutation";
import { useMutationState } from "./useMutationState";

afterEach(async () => resetStudioApolloClient());

describe("mutation state hook", () => {
  it("stays pending until every overlapping call settles", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const hook = renderHook(() => useMutationState(
      (call: "first" | "second") => (call === "first" ? first : second).promise,
    ));

    let firstCall!: Promise<string>;
    let secondCall!: Promise<string>;
    act(() => {
      firstCall = hook.result.current.mutateAsync("first");
      secondCall = hook.result.current.mutateAsync("second");
    });
    expect(hook.result.current.isPending).toBe(true);
    expect(hook.result.current.variables).toBe("second");

    await act(async () => {
      second.resolve("done");
      await secondCall;
    });
    expect(hook.result.current.isPending).toBe(true);

    await act(async () => {
      first.resolve("done");
      await firstCall;
    });
    expect(hook.result.current.isPending).toBe(false);
    expect(hook.result.current.isSuccess).toBe(true);
  });

  it("rejects from mutateAsync, swallows from mutate, and calls back error before settled", async () => {
    const failure = new Error("write failed");
    const order: string[] = [];
    const hook = renderHook(() => useMutationState(async (_: string) => {
      throw failure;
    }));
    const callbacks = {
      onSuccess: () => order.push("success"),
      onError: (error: Error) => order.push(`error:${error.message}`),
      onSettled: (_: unknown, error: Error | null) => order.push(`settled:${error?.message}`),
    };

    await act(async () => {
      await expect(hook.result.current.mutateAsync("a", callbacks)).rejects.toBe(failure);
    });
    act(() => hook.result.current.mutate("b", callbacks));
    await waitFor(() => expect(order).toHaveLength(4));

    expect(order).toEqual([
      "error:write failed",
      "settled:write failed",
      "error:write failed",
      "settled:write failed",
    ]);
    expect(hook.result.current.error).toBe(failure);
    expect(hook.result.current.isError).toBe(true);
    expect(hook.result.current.isPending).toBe(false);
  });

  it("builds the optimistic value from the cached entity the feature reads", async () => {
    const sent: Array<string | undefined> = [];
    const hook = renderHook(() => useMutationState(
      async (_: { id: string; name: string }, optimistic: string | undefined) => {
        sent.push(optimistic);
        return "ok";
      },
      {
        current: ({ id }): string | undefined => (id === "cached" ? "Before" : undefined),
        apply: (current, { name }) => `${current} -> ${name}`,
      },
    ));

    await act(async () => {
      await hook.result.current.mutateAsync({ id: "cached", name: "After" });
      await hook.result.current.mutateAsync({ id: "missing", name: "After" });
    });

    expect(sent).toEqual(["Before -> After", undefined]);
  });

  it("keeps every hook in one pending scope pending until each call in it settles", async () => {
    const calls = { left: deferred<string>(), right: deferred<string>() };
    const execute = (call: "left" | "right") => calls[call].promise;
    const hook = renderHook(() => ({
      left: useMutationState(execute, undefined, { pendingScope: "probe" }),
      right: useMutationState(execute, undefined, { pendingScope: "probe" }),
      unscoped: useMutationState(execute),
    }));
    const pending = () => [
      hook.result.current.left.isPending,
      hook.result.current.right.isPending,
      hook.result.current.unscoped.isPending,
    ];

    let left!: Promise<string>;
    let right!: Promise<string>;
    act(() => {
      left = hook.result.current.left.mutateAsync("left");
      right = hook.result.current.right.mutateAsync("right");
    });
    expect(pending()).toEqual([true, true, false]);

    await act(async () => {
      calls.left.resolve("done");
      await left;
    });
    expect(pending()).toEqual([true, true, false]);

    await act(async () => {
      calls.right.resolve("done");
      await right;
    });
    expect(pending()).toEqual([false, false, false]);
  });
});

describe("the next ordinary mutation", () => {
  // Everything this feature needs: one generated document and a short effects
  // declaration. No hand-written optimistic, refresh, error or state code.
  const renameIssue = declareMutation({
    document: UpdateWorkTrackerWorkItemDetailsDocument,
    variables: ({ id, name }: { id: string; name: string }) => ({ id, name }),
    root: "update_work_item",
    optimistic: ({ id, name }) => {
      const current = cachedIssue(id, true);
      return current ? { ...current, name } : undefined;
    },
    refresh: (_, entity) => [
      refreshRead(WorkTrackerModuleOpenDocument, { moduleId: entity.module_id ?? "" }),
    ],
    result: (entity) => entity.name,
  });

  it("gets optimistic, commit, non-joining refresh and hook state from the declaration", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { name: "Before" })]);
    const renamed = issueRow("item-1", { name: "Renamed", state_revision: 2 });
    const write = transport.holdNext("UpdateWorkTrackerWorkItemDetails");
    const preWriteRead = transport.holdNext("WorkTrackerModuleOpen");
    transport.answer("WorkTrackerModuleOpen", moduleOpenData([renamed]));
    const staleRead = studioApolloClient().query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-1" },
    });
    await preWriteRead.reached;
    const hook = renderHook(() => useDeclaredMutation(renameIssue));

    let rename!: Promise<string>;
    act(() => {
      rename = hook.result.current.mutateAsync({ id: "item-1", name: "Renamed" });
    });
    await write.reached;
    expect(hook.result.current.isPending).toBe(true);
    expect(cachedIssue("item-1", true)).toMatchObject({ name: "Renamed" });

    write.answer({ update_work_item: renamed });
    await act(async () => {
      await expect(rename).resolves.toBe("Renamed");
    });
    preWriteRead.answer(moduleOpenData([issueRow("item-1", { name: "Before" })]));
    await staleRead;

    expect(transport.operationNames()).toEqual([
      "WorkTrackerModuleOpen",
      "UpdateWorkTrackerWorkItemDetails",
      "WorkTrackerModuleOpen",
    ]);
    expect(hook.result.current).toMatchObject({ isPending: false, isSuccess: true });
    expect(cachedIssue("item-1")).toMatchObject({ name: "Renamed" });
    expect(cachedModuleIds("module-1")).toEqual(["item-1"]);
  });

  it("rolls back and reports a mapped, phase-tagged write failure through the hook", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { name: "Before" })]);
    transport.failNext("UpdateWorkTrackerWorkItemDetails", "not_found", "Gone");
    const hook = renderHook(() => useDeclaredMutation(renameIssue));
    const errors: Error[] = [];

    act(() => hook.result.current.mutate(
      { id: "item-1", name: "Renamed" },
      { onError: (error) => errors.push(error) },
    ));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ApiError);
    expect(errors[0]).toMatchObject({ status: 404 });
    expect(mutationFailurePhase(errors[0])).toBe("write");
    expect(cachedIssue("item-1", true)).toMatchObject({ name: "Before" });
    expect(transport.operationNames()).toEqual(["UpdateWorkTrackerWorkItemDetails"]);
  });
});
