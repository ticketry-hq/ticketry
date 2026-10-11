import { expect, it } from "vitest";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { useStudioStore } from "../features/projects";
import { seedModuleLinks } from "../features/module-links";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import { useClientStore } from "../state/clientStore";
import { RECENT_MODULE_KEY } from "../state/persistence";
import { projectOpenFixture } from "./projectOpenFixture";
import type { Module } from "../shared/api/types";

it("[overhaul-499] ignores late startup module selection and errors from an obsolete project visit", async () => {
  let releaseA: () => void = () => {};
  let releaseB: () => void = () => {};
  const pendingA = new Promise<void>((resolve) => { releaseA = resolve; });
  const pendingB = new Promise<void>((resolve) => { releaseB = resolve; });
  let blockB = false;
  const moduleReads: Array<{ projectId: string; moduleId: string }> = [];
  const execute = async <TResult, TVariables>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
    const input = variables as { projectId: string; moduleId: string };
    const operation = documentOperationName(document);
    if (operation === "WorkTrackerProjectOpen") {
      if (input.projectId === "project-a") await pendingA;
      if (input.projectId === "project-b" && blockB) { await pendingB; throw new Error("Obsolete project B unavailable"); }
      const module: Module = { id: `module-${input.projectId}`, project_id: input.projectId, name: input.projectId,
        sequence_id: 1, key: "PROJECT-1", is_archived: false, issue_type: "module" };
      return projectOpenFixture({ id: input.projectId, name: input.projectId, slug: "PROJECT", description: "" }, [module]).data as TResult;
    }
    if (operation === "WorkTrackerModuleOpen") {
      moduleReads.push(input);
      return { module: { __typename: "WorktrackerIssueConnection", nodes: [] },
        work_items: { __typename: "WorktrackerIssueConnection", nodes: [] } } as TResult;
    }
    throw new Error("Unexpected operation " + operation);
  };
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({ ...browser, graphQlTransport: () => ({
    graphql_execute: async (json: string) => { const request = JSON.parse(json); return JSON.stringify({ data: await execute({ kind: "Document", operationName: request.operationName, source: request.query }, request.variables) }); },
    graphql_subscribe: async () => "subscription", graphql_unsubscribe: async () => true,
  }), readWorkTracker: (routes) => routes.graphQl(execute) });
  seedModuleLinks([{ id: "link-a", moduleId: "module-project-a", path: "/repos/project-a" }]);
  localStorage.setItem(RECENT_MODULE_KEY, "module-project-a");
  useStudioStore.setState({ selectedProjectId: null, error: null });
  useClientStore.setState({ selectedModuleId: null, selectedTaskId: null });
  const firstVisitA = useStudioStore.getState().selectProject("project-a");
  await useStudioStore.getState().selectProject("project-b");
  releaseA(); await firstVisitA;
  expect(useStudioStore.getState().selectedProjectId).toBe("project-b");
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  expect(moduleReads).toEqual([]);
  blockB = true;
  await useStudioStore.getState().selectProject("project-a");
  const obsoleteB = useStudioStore.getState().selectProject("project-b");
  await useStudioStore.getState().selectProject("project-a");
  releaseB(); await obsoleteB;
  expect(useStudioStore.getState().selectedProjectId).toBe("project-a");
  expect(useClientStore.getState().selectedModuleId).toBe("module-project-a");
  expect(useStudioStore.getState().error).toBeNull();
});
