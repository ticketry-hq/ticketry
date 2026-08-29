import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import type { Module, Project } from "../../shared/api/types";
import {
  resetStudioApolloClient,
  studioApolloClient,
} from "../../shared/apollo/client";
import { projectOpenFixture } from "../../test/projectOpenFixture";
import { WorkTrackerProjectOpenDocument } from "./generated/projects.documents";
import { setModuleTabHidden } from "./modulePresentationTransport";

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
    id: PROJECT_ID,
    name: "Project",
    slug: "PRJ",
    description: "",
  };
  const module: Module = {
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

afterEach(async () => resetStudioApolloClient());

describe("Apollo module presentation writes", () => {
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
