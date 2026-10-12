import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { executeGraphQlTransport } from "../../runtime/graphQlTransport";
import { acknowledgeOnboarding, createProject, deleteProject, updateProject } from "./mutationTransport";

const COMPACT_ID = "123456781234123412341234567890ab";
const PUBLIC_ID = "12345678-1234-1234-1234-1234567890ab";

afterEach(() => vi.restoreAllMocks());

function install(response: Record<string, unknown>) {
  const execute = vi.fn(async (_request: string) => JSON.stringify({ data: response }));
  initializeStudioRuntime({
    ...createBrowserRuntime({ environment: {} }),
    writeWorkTracker: (routes) => routes.graphQl((document, variables) => executeGraphQlTransport(document, variables, () => ({
      graphql_execute: execute,
      graphql_subscribe: async () => "subscription",
      graphql_unsubscribe: async () => true,
    }))),
  });
  return execute;
}

describe("generated project write I/O", () => {
  it("creates using only authored fields and returns a public project identity", async () => {
    const execute = install({ create_project: { id: COMPACT_ID, name: "Project", slug: "PRJ", description: "" } });
    const input = { name: "Project", slug: "PRJ", description: "", created_at: "protected" };

    expect(await createProject(input)).toEqual({
      id: PUBLIC_ID, name: "Project", slug: "PRJ", description: "",
    });
    expect(JSON.parse(execute.mock.calls[0][0]).variables).toEqual({
      name: "Project", slug: "PRJ", description: "",
    });
  });

  it("updates an identity using authored writable fields while preserving null", async () => {
    const execute = install({ update_project: { id: COMPACT_ID, name: "Updated", slug: "PRJ", description: "" } });
    const input = { id: PUBLIC_ID, name: "Updated", description: null, slug: "protected", created_at: "protected" };
    expect(await updateProject(input)).toEqual({ id: PUBLIC_ID, name: "Updated", slug: "PRJ", description: "" });
    expect(JSON.parse(execute.mock.calls[0][0]).variables).toEqual({ id: COMPACT_ID, name: "Updated", description: null });
  });

  it("acknowledges onboarding and deletes using compact identities", async () => {
    const acknowledge = install({ acknowledge_onboarding: { id: COMPACT_ID, name: "Project", slug: "PRJ", onboarding_required: false } });
    expect(await acknowledgeOnboarding(PUBLIC_ID)).toEqual({ id: PUBLIC_ID, name: "Project", slug: "PRJ", onboarding_required: false });
    expect(JSON.parse(acknowledge.mock.calls[0][0]).variables).toEqual({ projectId: COMPACT_ID });
    const remove = install({ delete_project: true });
    await deleteProject(PUBLIC_ID);
    expect(JSON.parse(remove.mock.calls[0][0]).variables).toEqual({ id: COMPACT_ID });
  });
});
