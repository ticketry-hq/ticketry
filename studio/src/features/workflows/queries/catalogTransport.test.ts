import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/query/queryClient";
import { createDesktopRuntime } from "../../../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../../../runtime";
import { loadSettings } from "../../settings/queries";
import { readSubtreeRunCapabilities, readWorkflowIssueTypes, readWorkflowStates } from "./readTransport";

// Every workflow-catalogue reader selects one collection out of the same
// document. Opening project settings fires three of them at once, so the
// contract under test is that they cost a single catalogue round-trip.

const PROJECT = "11111111-1111-1111-1111-111111111111";
const STATE_ID = "22222222222222222222222222222222";
const ISSUE_TYPE_ID = "33333333333333333333333333333333";

const CATALOG = {
  states: {
    nodes: [{
      id: STATE_ID,
      project: PROJECT.replace(/-/g, ""),
      name: "Implement",
      group: "started",
      color: null,
      sort_order: 0,
      is_protected: false,
      created_at: "2026-08-12T00:00:00",
      updated_at: "2026-08-12T00:00:00",
    }],
  },
  issue_types: {
    nodes: [{
      id: ISSUE_TYPE_ID,
      project: PROJECT.replace(/-/g, ""),
      name: "Task",
      level: "task",
      color: null,
      sort_order: 0,
      start_state: STATE_ID,
      workflow_revision: 1,
      is_pathfind: false,
      created_at: "2026-08-12T00:00:00",
      updated_at: "2026-08-12T00:00:00",
    }],
  },
  launch_bindings: {
    nodes: [{
      id: 1,
      issue_type: ISSUE_TYPE_ID,
      state: STATE_ID,
      prompt: "",
      required_skills: [],
      model: null,
      reasoning: null,
      auto_start: false,
      subtree_run_enabled: true,
      created_at: "2026-08-12T00:00:00",
      updated_at: "2026-08-12T00:00:00",
      issueType: { sort_order: 0 },
      state_record: { sort_order: 0 },
    }],
  },
  providers: { nodes: [] },
  agent_models: { nodes: [] },
  reasoning_levels: { nodes: [] },
};

function catalogRuntime() {
  const graphqlExecute = vi.fn(async (requestJson: string) => {
    const request = JSON.parse(requestJson) as { operationName: string };
    if (request.operationName !== "WorkTrackerWorkflowCatalog") {
      throw new Error(`Unexpected operation ${request.operationName}`);
    }
    return JSON.stringify({ data: CATALOG });
  });
  const startupInvoke = vi.fn().mockResolvedValue({
    endpoints: {
      workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
      agentApi: "http://127.0.0.1:8787/api",
      statusApi: "http://127.0.0.1:8787/api",
      terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
    },
    values: { workTrackerApiKey: "" },
    serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
    initialNotices: [],
  });
  return { graphqlExecute, startupInvoke };
}

async function useCatalogRuntime() {
  const { graphqlExecute, startupInvoke } = catalogRuntime();
  initializeStudioRuntime(await createDesktopRuntime({
    invoke: startupInvoke,
    createGraphQlProxy: () => ({
      graphql_execute: graphqlExecute,
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  }));
  return graphqlExecute;
}

beforeEach(() => {
  queryClient.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workflow catalogue reads", () => {
  it("serves concurrent catalogue readers from one round-trip", async () => {
    const graphqlExecute = await useCatalogRuntime();

    const [states, issueTypes, capabilities] = await Promise.all([
      readWorkflowStates(PROJECT),
      readWorkflowIssueTypes(PROJECT),
      readSubtreeRunCapabilities(PROJECT),
    ]);

    expect(graphqlExecute).toHaveBeenCalledOnce();
    expect(states.map((state) => state.name)).toEqual(["Implement"]);
    expect(issueTypes.map((type) => type.name)).toEqual(["Task"]);
    expect(capabilities).toEqual({
      [`33333333-3333-3333-3333-333333333333`]: ["22222222-2222-2222-2222-222222222222"],
    });
  });

  it("costs one catalogue query per settings load", async () => {
    const graphqlExecute = await useCatalogRuntime();

    await loadSettings(PROJECT);
    expect(graphqlExecute).toHaveBeenCalledOnce();

    // A later load is a deliberate refresh, so it reads the catalogue again.
    await loadSettings(PROJECT);
    expect(graphqlExecute).toHaveBeenCalledTimes(2);
  });
});
