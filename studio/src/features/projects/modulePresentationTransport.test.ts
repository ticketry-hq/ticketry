import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import type { Module, Project } from "./types";
import {
  resetStudioApolloClient,
  studioApolloClient,
} from "../../shared/apollo/client";
import { projectOpenFixture } from "../../test/projectOpenFixture";
import { WorkTrackerProjectOpenDocument } from "./generated/projects.documents";
import { getModulePresentationsSnapshot } from "./modulePresentation";
import { reorderModulePresentation, setModuleTabHidden } from "./modulePresentationTransport";

const PROJECT_ID = "10000000000000000000000000000000";
const MODULE_ID = "20000000000000000000000000000000";

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
  const project: Project = {
    created_at: "2026-01-01T00:00:00Z",
    id: PROJECT_ID,
    name: "Project",
    slug: "PRJ",
    description: "",
  };
  const module: Module = {
    rank: "",
    project: null,
    id: MODULE_ID,
    project_id: PROJECT_ID,
    name: "Module",
    key: "PRJ-1",
    sequence_id: 1,
    is_archived: false,
    issue_type: "30000000000000000000000000000000",
  };
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: PROJECT_ID },
    data: projectOpenFixture({ ...project, manual_module_order: true }, [module]).data,
  });
}

function cachedVisibility(): { rank: string; tabHidden: boolean } | undefined {
  const presentation = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: PROJECT_ID },
    optimistic: true,
  })?.module_presentations.nodes[0];
  return presentation
    ? { rank: presentation.rank, tabHidden: presentation.tab_hidden }
    : undefined;
}

afterEach(async () => { vi.restoreAllMocks(); resetStudioApolloClient(); });

describe("Apollo module presentation writes", () => {
  it("reads a public presentation snapshot while retaining compact source rows", () => {
    installTransport(async () => { throw new Error("cache-only read unexpectedly fetched"); });
    const client = studioApolloClient();
    const cached = client.readQuery({ query: WorkTrackerProjectOpenDocument,
      variables: { projectId: PROJECT_ID },
    })!;
    const raw = { ...cached, module_presentations: { nodes: [{
      module_id: MODULE_ID, rank: "00000000", tab_hidden: false,
      module: { id: MODULE_ID, project_id: PROJECT_ID },
    }] } };
    const read = vi.spyOn(client, "readQuery").mockReturnValue(raw);
    expect(getModulePresentationsSnapshot("10000000-0000-0000-0000-000000000000")).toMatchObject([{
      module_id: "20000000-0000-0000-0000-000000000000",
      module: {
        id: "20000000-0000-0000-0000-000000000000",
        project_id: "10000000-0000-0000-0000-000000000000",
      },
    }]);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ variables: { projectId: PROJECT_ID } }));
    expect(raw.module_presentations.nodes[0].module_id).toBe(MODULE_ID);
  });
  it("reorders with compact neighbor variables and returns a public module identity", async () => {
    const moduleId = "20000000-0000-0000-0000-000000000000";
    const beforeId = "30000000-0000-0000-0000-000000000000";
    const afterId = "40000000-0000-0000-0000-000000000000";
    const mutate = vi.spyOn(studioApolloClient(), "mutate").mockResolvedValue({
      data: { reorder_module_presentation: {
        __typename: "WorktrackerModulepresentation", module_id: MODULE_ID,
        rank: "middle", tab_hidden: false,
      } },
    });
    const neighbors = { before_id: beforeId, after_id: afterId, initial_order_ids: [beforeId, moduleId, afterId], rank: "protected" };
    expect(await reorderModulePresentation(moduleId, neighbors)).toEqual({
      __typename: "WorktrackerModulepresentation", module_id: moduleId,
      rank: "middle", tab_hidden: false,
    });
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ variables: {
      moduleId: MODULE_ID, beforeId: "30000000000000000000000000000000",
      afterId: "40000000000000000000000000000000",
      initialOrderIds: ["30000000000000000000000000000000", MODULE_ID, "40000000000000000000000000000000"],
    } }));
  });

  it("preserves rank optimistically and rolls visibility back on failure", async () => {
    const response = deferred<string>();
    const requests: string[] = [];
    installTransport(async (request) => {
      requests.push(request);
      return response.promise;
    });

    const saving = setModuleTabHidden(PROJECT_ID, MODULE_ID, true);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(cachedVisibility()).toEqual({ rank: "00000000", tabHidden: true });

    response.resolve(JSON.stringify({
      errors: [{ message: "visibility failed", extensions: { code: "validation" } }],
    }));
    await expect(saving).rejects.toThrow("visibility failed");
    expect(cachedVisibility()).toEqual({ rank: "00000000", tabHidden: false });
  });
});
