import { describe, expect, it, vi } from "vitest";
import { studioApolloClient } from "../../../shared/apollo/client";
import { createProjectRecord } from "./index";
import { createBrowserRuntime, initializeStudioRuntime } from "../../../runtime";
import { executeGraphQlTransport } from "../../../runtime/graphQlTransport";

describe("project creation result", () => {
  it("returns the committed project when refreshing the projects list fails", async () => {
    const created = { id: "10000000000000000000000000000000", name: "Project", slug: "PRJ", description: "" };
    initializeStudioRuntime({
      ...createBrowserRuntime({ environment: {} }),
      writeWorkTracker: (routes) => routes.graphQl((document, variables) => executeGraphQlTransport(document, variables, () => ({
        graphql_execute: async () => JSON.stringify({ data: { create_project: created } }),
        graphql_subscribe: async () => "subscription",
        graphql_unsubscribe: async () => true,
      }))),
    });
    vi.spyOn(studioApolloClient(), "query").mockRejectedValue(new Error("Refresh unavailable"));
    await expect(createProjectRecord({ name: "Project", slug: "PRJ" })).resolves.toEqual({
      ...created, id: "10000000-0000-0000-0000-000000000000",
    });
  });
});
