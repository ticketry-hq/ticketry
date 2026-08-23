import { afterEach, describe, expect, it, vi } from "vitest";
import { getCapabilitiesSnapshot } from "../features/settings";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { queryClient } from "../shared/query/queryClient";

const startup = {
  serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
  initialNotices: [],
};

const provider = {
  id: "provider-codex", slug: "codex", activated: true, supports_unattended: true,
};
const model = {
  id: "model-gpt", provider: provider.id, name: "gpt-5.6-luna",
  reasoning_levels: { nodes: [{ reasoning_level_id: "reasoning-medium" }] },
};
const reasoning = { id: "reasoning-medium", name: "medium" };
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
    states: { nodes: [state] },
    issue_types: { nodes: [{ ...issueType, workflow_revision: workflowRevision }] },
    launch_bindings: { nodes: [{
      id: 1, issue_type: "story", state: "build", prompt: "Implement it.",
      required_skills: ["tdd"], model: model.id, reasoning: reasoning.id,
      auto_start: false, subtree_run_enabled: subtreeRunEnabled,
      created_at: "", updated_at: "",
      issueType: { sort_order: 0 }, state_record: { sort_order: 0 },
    }] },
    providers: { nodes: [provider] },
    agent_models: { nodes: [{
      ...model,
      provider_record: { slug: provider.slug },
      reasoning_levels: { nodes: [{ reasoning_level_id: "reasoning-medium" }] },
    }] },
    reasoning_levels: { nodes: [reasoning] },
  };
}

describe("launch-binding desktop runtime acceptance", () => {
  afterEach(() => {
    queryClient.clear();
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
      if (request.operationName === "WorkTrackerWorkflowCatalog") {
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
      if (request.operationName === "WorkTrackerIssueTypeTransitions") {
        return JSON.stringify({ data: { issue_type_transitions: { nodes: [] } } });
      }
      if (request.operationName === "LoadProviderCatalog") {
        return JSON.stringify({ data: { provider_catalog: {
          configurable_providers: [provider], providers: [provider],
          agent_models: [model], reasoning_levels: [reasoning],
          global_default: { provider: "codex", model: model.name, reasoning: "medium" },
        } } });
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
    queryClient.clear();
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
      "WorkTrackerWorkflowCatalog",
      "UpsertWorkTrackerLaunchBinding",
      "WorkTrackerWorkflowCatalog",
      "WorkTrackerIssueTypeTransitions",
      "LoadProviderCatalog",
    ]);
  });
});
