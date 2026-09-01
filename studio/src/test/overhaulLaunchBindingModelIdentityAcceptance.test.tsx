import { afterEach, describe, expect, it, vi } from "vitest";
import { getProviderCapabilitiesSnapshot } from "../features/workflows/providerQueries";
import { readWorkflowSettings } from "../features/workflows/queries/readTransport";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { publicWorktrackerId } from "../shared/api/generatedWorktracker";

const startup = {
  serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
  initialNotices: [],
};

// The host stores every catalog identity as a compact (dash-free) UUID, exactly
// as `uuid::Uuid::simple()` writes it. Studio republishes row identities in the
// hyphenated public form, so a launch binding's model/reasoning ids must still
// resolve against the compact catalog rows.
const PROJECT_ID = "11111111111111111111111111111111";
const ISSUE_TYPE_ID = "22222222222222222222222222222222";
const STATE_ID = "33333333333333333333333333333333";
const PROVIDER_ID = "44444444444444444444444444444444";
const MODEL_ID = "55555555555555555555555555555555";
const REASONING_ID = "66666666666666666666666666666666";

const provider = {
  __typename: "WorktrackerProvider", id: PROVIDER_ID, slug: "codex",
  activated: true, supports_unattended: true,
};
const model = {
  __typename: "WorktrackerAgentmodel", id: MODEL_ID, provider: PROVIDER_ID,
  name: "gpt-5.6-luna",
  reasoning_levels: {
    __typename: "WorktrackerAgentmodelreasoninglevelConnection",
    nodes: [{
      __typename: "WorktrackerAgentmodelreasoninglevel",
      id: 1, reasoning_level_id: REASONING_ID,
    }],
  },
};
const reasoning = {
  __typename: "WorktrackerReasoninglevel", id: REASONING_ID, name: "medium",
};

const catalog = {
  __typename: "WorkTrackerProjectOpen",
  project: { __typename: "WorktrackerProjectConnection", nodes: [{
    __typename: "WorktrackerProject",
    id: PROJECT_ID, name: "Project", slug: "PROJECT", description: "",
    created_at: "",
  }] },
  modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
  module_presentations: {
    __typename: "WorktrackerModulepresentationConnection", nodes: [],
  },
  states: { __typename: "WorktrackerStateConnection", nodes: [{
    __typename: "WorktrackerState",
    id: STATE_ID, project: PROJECT_ID, name: "Build", group: "started",
    color: "", sort_order: 0, is_protected: false,
    created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
  }] },
  issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: [{
    __typename: "WorktrackerIssuetype",
    id: ISSUE_TYPE_ID, project: PROJECT_ID, name: "Implementation",
    level: "task", color: "", sort_order: 0, start_state: STATE_ID,
    workflow_revision: 8, is_pathfind: false,
    created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
    transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: [] },
    launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [{
      __typename: "WorktrackerLaunchbinding",
      id: 1, issue_type: ISSUE_TYPE_ID, state: STATE_ID,
      prompt: "Implement it.", required_skills: ["tdd"],
      model: MODEL_ID, reasoning: REASONING_ID,
      auto_start: false, subtree_run_enabled: false,
      created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
      state_record: { __typename: "WorktrackerState", id: STATE_ID, sort_order: 0 },
    }] },
  }] },
  provider_catalog: {
    __typename: "ProviderCatalog",
    configurable_providers: [provider], providers: [provider],
    agent_models: [model], reasoning_levels: [reasoning],
    global_default: {
      __typename: "GlobalLaunchDefault",
      provider: "codex", model: model.name, reasoning: "medium",
    },
  },
};

describe("launch-binding model identity acceptance", () => {
  afterEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });

  it("[overhaul-218] reads back the stored model configuration for a compact-UUID catalog", async () => {
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const request = JSON.parse(encoded) as { operationName: string };
      if (request.operationName === "WorkTrackerProjectOpen") {
        return JSON.stringify({ data: catalog });
      }
      throw new Error(`Unexpected operation ${request.operationName}`);
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));

    // Studio addresses rows by their hyphenated public identity, the form the
    // workflow editor holds in state.
    const workflow = await readWorkflowSettings(
      PROJECT_ID,
      publicWorktrackerId(ISSUE_TYPE_ID),
    );

    expect(workflow.launch_bindings).toHaveLength(1);
    expect(workflow.launch_bindings[0]).toMatchObject({
      prompt: "Implement it.",
      agent: "codex",
      model: "gpt-5.6-luna",
      reasoning: "medium",
    });
    // The stored provider resolved, so its activation is judged against the
    // real catalog row rather than reported as unconfigured.
    expect(workflow.warnings.map((warning) => warning.code)).not.toContain(
      "provider_not_activated",
    );
  });

  it("[overhaul-219] refuses an agent selection with no model instead of storing nothing", async () => {
    const operations: string[] = [];
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const request = JSON.parse(encoded) as { operationName: string };
      operations.push(request.operationName);
      if (request.operationName === "WorkTrackerProjectOpen") {
        return JSON.stringify({ data: catalog });
      }
      throw new Error(`Unexpected operation ${request.operationName}`);
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));
    const issueTypeId = publicWorktrackerId(ISSUE_TYPE_ID);
    const stateId = publicWorktrackerId(STATE_ID);
    useWorkflowEditorStore.setState({
      projectId: PROJECT_ID,
      issueTypes: [],
      states: [],
      stateWorkItemCounts: {},
      providerCapabilities: [],
      selectedTypeId: issueTypeId,
      workflows: { [issueTypeId]: {
        issue_type_id: issueTypeId, start_state_id: stateId,
        workflow_revision: 8, transitions: [], launch_bindings: [],
        warnings: [],
      } },
      stagedStateIds: {}, loading: false, action: null, notice: null,
      error: null, controlErrors: {},
    });

    await useWorkflowEditorStore.getState().upsertLaunchBinding(
      issueTypeId,
      stateId,
      { prompt: "Implement it.", agent: "codex", model: null, reasoning: null },
      "launch",
    );

    expect(useWorkflowEditorStore.getState().controlErrors.launch)
      .toContain("Choose a model for agent/provider 'codex'");
    expect(operations).not.toContain("UpsertWorkTrackerLaunchBinding");
  });

  it("[overhaul-220] saves catalog UUIDs after the editor routes its capabilities back into the cache", async () => {
    let upsertVariables: Record<string, unknown> | undefined;
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const request = JSON.parse(encoded) as {
        operationName: string;
        variables: Record<string, unknown>;
      };
      if (request.operationName === "WorkTrackerProjectOpen") {
        return JSON.stringify({ data: catalog });
      }
      if (request.operationName === "UpsertWorkTrackerLaunchBinding") {
        upsertVariables = request.variables;
        return JSON.stringify({
          data: { upsert_issue_type_launch_binding: { id: 1 } },
        });
      }
      throw new Error(`Unexpected operation ${request.operationName}`);
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));
    const issueTypeId = publicWorktrackerId(ISSUE_TYPE_ID);
    const stateId = publicWorktrackerId(STATE_ID);
    await readWorkflowSettings(PROJECT_ID, issueTypeId);

    // The workflow editor loads capabilities derived from the cached catalog,
    // and its store subscription routes every own value straight back into
    // the cache. Feeding the store here runs that same round-trip.
    const capabilities = getProviderCapabilitiesSnapshot() ?? [];
    expect(capabilities).not.toHaveLength(0);

    useWorkflowEditorStore.setState({
      projectId: PROJECT_ID,
      issueTypes: [],
      states: [],
      stateWorkItemCounts: {},
      providerCapabilities: capabilities,
      selectedTypeId: issueTypeId,
      workflows: { [issueTypeId]: {
        issue_type_id: issueTypeId, start_state_id: stateId,
        workflow_revision: 8, transitions: [], launch_bindings: [],
        warnings: [],
      } },
      stagedStateIds: {}, loading: false, action: null, notice: null,
      error: null, controlErrors: {},
    });

    await useWorkflowEditorStore.getState().upsertLaunchBinding(
      issueTypeId,
      stateId,
      {
        prompt: "Implement it.",
        agent: "codex",
        model: "gpt-5.6-luna",
        reasoning: "medium",
      },
      "launch",
    );

    expect(useWorkflowEditorStore.getState().controlErrors.launch ?? "").toBe("");
    expect(upsertVariables).toMatchObject({
      modelId: MODEL_ID,
      reasoningId: REASONING_ID,
    });
  });
});
