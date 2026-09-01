import { afterEach, describe, expect, it, vi } from "vitest";
import { getCapabilitiesSnapshot } from "../features/settings";
import { upsertIssueTypeWorkflowLaunchBinding } from "../features/workflows/mutationTransport";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";

const startup = {
  serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
  initialNotices: [],
};

const provider = {
  __typename: "WorktrackerProvider", id: "provider-codex", slug: "codex", activated: true, supports_unattended: true,
};
const model = {
  __typename: "WorktrackerAgentmodel", id: "model-gpt", provider: provider.id, name: "gpt-5.6-luna",
  reasoning_levels: { __typename: "WorktrackerAgentmodelreasoninglevelConnection", nodes: [{ __typename: "WorktrackerAgentmodelreasoninglevel", id: 1, reasoning_level_id: "reasoning-medium" }] },
};
const reasoning = { __typename: "WorktrackerReasoninglevel", id: "reasoning-medium", name: "medium" };
const issueType = {
  id: "story", project: "project-1", name: "Story", level: "task" as const,
  color: "", sort_order: 0, start_state: "build", workflow_revision: 8,
  is_pathfind: false, created_at: "", updated_at: "",
};
const state = {
  id: "build", project: "project-1", name: "Build", group: "started",
  color: "", sort_order: 0, is_protected: false, created_at: "", updated_at: "",
};

function catalog(subtreeRunEnabled: boolean, workflowRevision: number) {
  return {
    __typename: "WorkTrackerProjectOpen",
    project: { __typename: "WorktrackerProjectConnection", nodes: [{
      __typename: "WorktrackerProject",
      id: "project-1", name: "Project", slug: "PROJECT", description: "",
      created_at: "",
    }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
    module_presentations: {
      __typename: "WorktrackerModulepresentationConnection",
      nodes: [],
    },
    states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", ...state }] },
    issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: [{
      __typename: "WorktrackerIssuetype",
      ...issueType,
      workflow_revision: workflowRevision,
      transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: [] },
      launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [{
        __typename: "WorktrackerLaunchbinding",
        id: 1, issue_type: "story", state: "build", prompt: "Implement it.",
        required_skills: ["tdd"], model: model.id, reasoning: reasoning.id,
        auto_start: false, subtree_run_enabled: subtreeRunEnabled,
        created_at: "", updated_at: "", state_record: { __typename: "WorktrackerState", id: "build", sort_order: 0 },
      }] },
    }] },
    provider_catalog: {
      __typename: "ProviderCatalog",
      configurable_providers: [provider], providers: [provider],
      agent_models: [model], reasoning_levels: [reasoning],
      global_default: { __typename: "GlobalLaunchDefault", provider: "codex", model: model.name, reasoning: "medium" },
    },
  };
}

describe("launch-binding desktop runtime acceptance", () => {
  afterEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });

  it("[overhaul-80] preserves hidden skills and reloads authoritative workflow projections after a GraphQL revision conflict", async () => {
    const operations: string[] = [];
    let catalogRead = 0;
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const request = JSON.parse(encoded) as {
        operationName: string;
        variables: Record<string, unknown>;
      };
      operations.push(request.operationName);
      if (request.operationName === "WorkTrackerProjectOpen") {
        catalogRead += 1;
        return JSON.stringify({ data: catalog(catalogRead > 1, catalogRead > 1 ? 9 : 8) });
      }
      if (request.operationName === "UpsertWorkTrackerLaunchBinding") {
        expect(request.variables.requiredSkills).toEqual(["tdd"]);
        expect(request.variables.workflowRevision).toBe(8);
        return JSON.stringify({
          data: null,
          errors: [{
            message: "Workflow revision is stale; read the current workflow and retry.",
            extensions: { code: "stale_revision" },
          }],
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
    useWorkflowEditorStore.setState({
      projectId: "project-1",
      issueTypes: [issueType],
      states: [state],
      stateWorkItemCounts: {},
      providerCapabilities: [],
      selectedTypeId: "story",
      workflows: { story: {
        issue_type_id: "story", start_state_id: "build", workflow_revision: 8,
        transitions: [], launch_bindings: [{
          state_id: "build", prompt: "Implement it.", required_skills: ["tdd"],
          agent: "codex", model: model.name, reasoning: "medium",
          auto_start: false, subtree_run_enabled: false,
        }], warnings: [],
      } },
      stagedStateIds: {}, loading: false, action: null, notice: null,
      error: null, controlErrors: {},
    });

    await useWorkflowEditorStore.getState().upsertLaunchBinding(
      "story",
      "build",
      { prompt: "Implement it.", agent: "codex", model: model.name, reasoning: "medium" },
      "launch:story:build",
    );

    const current = useWorkflowEditorStore.getState();
    expect(current.workflows.story.workflow_revision).toBe(9);
    expect(current.workflows.story.launch_bindings[0].required_skills).toEqual(["tdd"]);
    expect(current.notice).toBe("Workflow changed elsewhere. Latest settings loaded.");
    expect(getCapabilitiesSnapshot("project-1")).toEqual({ story: ["build"] });
    expect(operations).toEqual([
      "WorkTrackerProjectOpen",
      "UpsertWorkTrackerLaunchBinding",
      "WorkTrackerProjectOpen",
    ]);
  });

  it("omits an unsupplied prompt instead of clearing the stored one", async () => {
    // The transport used to send `prompt: binding.prompt ?? ""`, so a patch
    // that did not carry a prompt cleared the configured one. Every launch for
    // the type/state then failed with `prompt_not_configured`, which records no
    // durable trace at all (ticket #1372).
    let variables: Record<string, unknown> | null = null;
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const request = JSON.parse(encoded) as {
        operationName: string;
        variables: Record<string, unknown>;
      };
      if (request.operationName === "WorkTrackerProjectOpen") {
        return JSON.stringify({ data: catalog(false, 8) });
      }
      variables = request.variables;
      return JSON.stringify({ data: { upsert_issue_type_launch_binding: { id: 1 } } });
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));

    await upsertIssueTypeWorkflowLaunchBinding(
      "project-1",
      "story",
      "build",
      { agent: "codex", model: model.name, reasoning: "medium" },
      8,
      false,
      false,
    );

    expect(variables).not.toBeNull();
    expect(variables!).not.toHaveProperty("prompt");
    expect(variables!).not.toHaveProperty("requiredSkills");
    expect(variables!.modelId).toBe(model.id);
  });
});
