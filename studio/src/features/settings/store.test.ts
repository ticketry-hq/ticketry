import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { studioApolloClient, resetStudioApolloClient } from "../../shared/apollo/client";
import { installDesktopGraphQlRuntime } from "../../test/desktopGraphQlRuntime";
import { WorkTrackerProjectOpenDocument } from "../projects";
import { getIssueTypesSnapshot } from "./queries";
import { useSettingsStore } from "./store";

const row = {
  __typename: "WorktrackerIssuetype", id: "type-1", project: "project-1", name: "New task", level: "task",
  color: "blue", sort_order: 1, start_state: null, workflow_revision: 2, is_pathfind: true,
  created_at: "2026-10-11T10:00:00Z", updated_at: "2026-10-11T11:00:00Z",
  transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: [] },
  launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [{
    __typename: "WorktrackerLaunchbinding", id: 1, issue_type: "type-1", state: "state-1", prompt: "Implement",
    required_skills: [], stage_skills: [], profile: null, model: null, reasoning: null,
    auto_start: false, subtree_run_enabled: true, created_at: "", updated_at: "", state_record: null,
  }] },
};
const catalog = {
  project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Project", slug: "TEST", description: "", created_at: "" }] },
  modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
  module_presentations: { __typename: "ModulePresentationsConnection", nodes: [] },
  states: { __typename: "WorktrackerStateConnection", nodes: [] },
  issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: [row] },
  provider_catalog: { __typename: "ProviderCatalog", providers: [], configurable_providers: [], agent_models: [], reasoning_levels: [], global_default: null },
};

afterEach(async () => {
  vi.restoreAllMocks();
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  await resetStudioApolloClient();
});

function setup(refreshFails = false) {
  installDesktopGraphQlRuntime(async () => ({
    create_issue_type: row, update_issue_type: row, reorder_issue_types: [row],
  }) as never);
  const client = studioApolloClient();
  const previous = { ...catalog, issue_types: { ...catalog.issue_types,
    nodes: [{ ...row, is_pathfind: false, updated_at: "2026-10-11T10:00:00Z" }],
  } };
  client.writeQuery({ query: WorkTrackerProjectOpenDocument, variables: { projectId: "project-1" }, data: previous as never });
  const query = vi.spyOn(client, "query").mockImplementation(async () => {
    if (refreshFails) throw new Error("offline");
    client.writeQuery({ query: WorkTrackerProjectOpenDocument, variables: { projectId: "project-1" }, data: catalog as never });
    return { data: catalog } as never;
  });
  useSettingsStore.setState({ projectId: "project-1", error: null });
  return query;
}

describe("issue type settings convergence", () => {
  it.each(["create", "update", "reorder"] as const)("%s reads authoritative fields and relationships after its scalar write", async (operation) => {
    const query = setup();
    const store = useSettingsStore.getState();
    const created = operation === "create" ? await store.createType({ name: "Task", level: "task" }) : null;
    if (operation === "update") await store.patchType("type-1", { name: "Optimistic task" });
    if (operation === "reorder") await store.reorderTypes(["type-1"]);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ fetchPolicy: "network-only" }));
    const [cached] = getIssueTypesSnapshot("project-1");
    expect(cached).toMatchObject({ name: "New task", is_pathfind: true, updated_at: "2026-10-11T11:00:00Z", launch_bindings: { nodes: [{ state: "state-1", subtree_run_enabled: true }] } });
    if (operation === "create") expect(created).toMatchObject({ launch_bindings: { nodes: [{ id: 1 }] } });
  });

  it("retains committed optimistic edits when the canonical refresh fails", async () => {
    setup(true);
    await useSettingsStore.getState().patchType("type-1", { name: "Committed task" });
    expect(getIssueTypesSnapshot("project-1")[0].name).toBe("Committed task");
    expect(useSettingsStore.getState().error).toContain("Issue type updated, but the catalog could not be refreshed: offline");
  });
});
