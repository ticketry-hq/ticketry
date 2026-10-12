import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Module } from "../../shared/api/types";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { useClientStore } from "../../state/clientStore";
import { projectOpenFixture } from "../../test/projectOpenFixture";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import { WorkTrackerProjectOpenDocument } from "./generated/projects.documents";
import { useReorderModule } from "./mutations";
import { getModulesSnapshot } from "./queries";

const PROJECT_ID = "project-1";
const project = { id: PROJECT_ID, name: "Project", slug: "PRJ", description: "" };

function modules(...ids: string[]): Module[] {
  return ids.map((id, index) => ({
    id,
    name: id,
    project_id: PROJECT_ID,
    key: `PRJ-${index + 1}`,
    sequence_id: index + 1,
    is_archived: false,
    issue_type: "module",
  }));
}

/** The project-open answer for a manual project that owns this module order. */
function projectOpen(...ids: string[]) {
  const { data } = projectOpenFixture({ ...project, manual_module_order: true }, modules(...ids));
  return { ...data, provider_catalog: { ...data.provider_catalog, codex_profiles: [] } };
}

const reorderAnswer = (moduleId: string) => ({
  reorder_module_presentation: {
    __typename: "WorktrackerModulepresentation",
    module_id: moduleId,
    rank: "V",
    tab_hidden: false,
  },
});

function cachedOrder(): string[] {
  return getModulesSnapshot(PROJECT_ID).map((module) => module.id);
}

function reorderErrorToasts(): string[] {
  return useClientStore
    .getState()
    .toasts.filter((toast) => toast.kind === "error")
    .map((toast) => toast.message);
}

beforeEach(() => {
  useClientStore.setState({ toasts: [] });
});

afterEach(async () => resetStudioApolloClient());

function seedAutomaticOrder(): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: PROJECT_ID },
    data: projectOpenFixture(project, modules("module-a", "module-b", "module-c")).data,
  });
}

describe("module-presentation reorder", () => {
  it("shows the planned order at once, then the server's order after commit", async () => {
    const transport = installScriptedGraphQlTransport();
    seedAutomaticOrder();
    const write = transport.holdNext("ReorderWorkTrackerModulePresentation");
    transport.answerNext("WorkTrackerProjectOpen", projectOpen("module-c", "module-b", "module-a"));
    const hook = renderHook(() => useReorderModule(PROJECT_ID));

    act(() => hook.result.current.reorder("module-c", "module-a", "near"));
    await write.reached;
    expect(cachedOrder()).toEqual(["module-c", "module-a", "module-b"]);
    expect(hook.result.current.isPending).toBe(true);

    write.answer(reorderAnswer("module-c"));
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));

    expect(transport.requests).toEqual([
      {
        operationName: "ReorderWorkTrackerModulePresentation",
        variables: {
          moduleId: "module-c",
          beforeId: null,
          afterId: "module-a",
          initialOrderIds: ["module-a", "module-b", "module-c"],
        },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: PROJECT_ID } },
    ]);
    expect(cachedOrder()).toEqual(["module-c", "module-b", "module-a"]);
    expect(reorderErrorToasts()).toEqual([]);
  });

  it("re-plans from an authoritative read and sends one new reorder when neighbours moved", async () => {
    const transport = installScriptedGraphQlTransport();
    seedAutomaticOrder();
    transport
      .failNext(
        "ReorderWorkTrackerModulePresentation",
        "validation",
        "before/after are not ordered neighbors.",
      )
      // Elsewhere the order became b, c, a; after the new write the server owns b, a, c.
      .answerNext("WorkTrackerProjectOpen", projectOpen("module-b", "module-c", "module-a"))
      .answerNext("ReorderWorkTrackerModulePresentation", reorderAnswer("module-c"))
      .answerNext("WorkTrackerProjectOpen", projectOpen("module-b", "module-a", "module-c"));
    const hook = renderHook(() => useReorderModule(PROJECT_ID));

    act(() => hook.result.current.reorder("module-c", "module-a", "far"));
    await waitFor(() => expect(transport.requests).toHaveLength(4));
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));

    const reorders = transport.requests.filter(
      (request) => request.operationName === "ReorderWorkTrackerModulePresentation",
    );
    expect(reorders.map((request) => request.variables)).toEqual([
      {
        moduleId: "module-c",
        beforeId: "module-a",
        afterId: "module-b",
        initialOrderIds: ["module-a", "module-b", "module-c"],
      },
      {
        moduleId: "module-c",
        beforeId: "module-a",
        afterId: null,
        initialOrderIds: ["module-b", "module-c", "module-a"],
      },
    ]);
    expect(transport.operationNames()).toEqual([
      "ReorderWorkTrackerModulePresentation",
      "WorkTrackerProjectOpen",
      "ReorderWorkTrackerModulePresentation",
      "WorkTrackerProjectOpen",
    ]);
    expect(cachedOrder()).toEqual(["module-b", "module-a", "module-c"]);
    expect(reorderErrorToasts()).toEqual([]);
  });

  it("rolls the order back and explains when the reorder is refused", async () => {
    const transport = installScriptedGraphQlTransport();
    seedAutomaticOrder();
    const write = transport.holdNext("ReorderWorkTrackerModulePresentation");
    const hook = renderHook(() => useReorderModule(PROJECT_ID));

    act(() => hook.result.current.reorder("module-c", "module-a", "near"));
    await write.reached;
    expect(cachedOrder()).toEqual(["module-c", "module-a", "module-b"]);

    write.fail("conflict", "Module order is locked");
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));

    expect(cachedOrder()).toEqual(["module-a", "module-b", "module-c"]);
    expect(transport.operationNames()).toEqual(["ReorderWorkTrackerModulePresentation"]);
    expect(reorderErrorToasts()).toEqual([
      "Modules could not be reordered: Module order is locked",
    ]);
  });

  it("keeps every reorder surface pending until overlapping reorders all settle", async () => {
    const transport = installScriptedGraphQlTransport();
    seedAutomaticOrder();
    const first = transport.holdNext("ReorderWorkTrackerModulePresentation");
    const second = transport.holdNext("ReorderWorkTrackerModulePresentation");
    transport.answer("WorkTrackerProjectOpen", projectOpen("module-b", "module-c", "module-a"));
    // The sidebar and the tab strip each own reorder controls for one project.
    const hook = renderHook(() => ({
      sidebar: useReorderModule(PROJECT_ID),
      tabStrip: useReorderModule(PROJECT_ID),
    }));
    const pending = () => [
      hook.result.current.sidebar.isPending,
      hook.result.current.tabStrip.isPending,
    ];

    act(() => {
      hook.result.current.sidebar.reorder("module-c", "module-a", "near");
      hook.result.current.tabStrip.reorder("module-b", "module-a", "near");
    });
    await Promise.all([first.reached, second.reached]);
    expect(pending()).toEqual([true, true]);

    first.answer(reorderAnswer("module-c"));
    await waitFor(() => expect(transport.operationNames()).toContain("WorkTrackerProjectOpen"));
    await act(async () => undefined);
    expect(pending()).toEqual([true, true]);

    second.answer(reorderAnswer("module-b"));
    await waitFor(() => expect(pending()).toEqual([false, false]));
  });
});
