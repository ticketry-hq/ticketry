import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { createState, updateState, reorderStates, createIssueType, updateIssueType, reorderIssueTypes, setIssueTypeWorkflowStartState, addIssueTypeWorkflowTransition, updateIssueTypeWorkflowTransition, removeIssueTypeWorkflowTransition, removeIssueTypeWorkflowState, setIssueTypeWorkflowAutoStart, setIssueTypeWorkflowSubtreeRun, upsertIssueTypeWorkflowLaunchBinding } from "./mutationTransport";

const id = "12345678-1234-1234-1234-123456789abc";
const compact = "12345678123412341234123456789abc";
const state = {
  id: compact, project: compact, name: "Ready", group: "unstarted", color: "blue",
  sort_order: 1, is_protected: false, created_at: "2026-10-11T10:00:00",
  updated_at: "2026-10-11T10:00:00",
};

afterEach(async () => {
  vi.restoreAllMocks();
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  await resetStudioApolloClient();
});

function stubWrite(data: unknown) {
  const browser = createBrowserRuntime({ environment: {} });
  const mutate = vi.fn(async (_options: { mutation: unknown; variables: unknown }) => ({ data }));
  vi.spyOn(studioApolloClient(), "mutate").mockImplementation(mutate as never);
  initializeStudioRuntime({ ...browser, writeWorkTracker: (routes) => routes.graphQl(async (document, variables) =>
    (await mutate({ mutation: document, variables })).data as never
  ) });
  return mutate;
}

const issueType = { ...state, level: "task", start_state: null, workflow_revision: 4, is_pathfind: false };

describe("workflow mutation feature I/O", () => {
  it("creates a state with compact allowed variables and returns converted generated fields", async () => {
    const mutate = stubWrite({ create_state: state });
    const result = await createState(id, { name: "Ready", group: "unstarted", color: "blue", projectId: "forged", is_protected: true } as never);
    expect(mutate.mock.calls[0][0].variables).toEqual({ projectId: compact, name: "Ready", group: "unstarted", color: "blue" });
    expect(result).toEqual({ ...state, id, project: id, created_at: "2026-10-11T10:00:00Z", updated_at: "2026-10-11T10:00:00Z" });
  });

  it.each([
    ["state update", () => updateState(id, { name: "Ready", color: null, sortOrder: 3, is_protected: true } as never), { update_state: state }, { id: compact, name: "Ready", group: undefined, color: null, sortOrder: 3 }],
    ["state reorder", () => reorderStates(id, [id]), { reorder_states: [state] }, { projectId: compact, orderedIds: [compact] }],
    ["issue type create", () => createIssueType(id, { name: "Task", level: "task", color: "blue", start_state: id } as never), { create_issue_type: issueType }, { projectId: compact, name: "Task", level: "task", color: "blue" }],
    ["issue type update", () => updateIssueType(id, { name: "Task", color: null, sortOrder: 2, level: "story", start_state: id, workflow_revision: 99 } as never), { update_issue_type: issueType }, { id: compact, name: "Task", color: null, sortOrder: 2 }],
    ["issue type reorder", () => reorderIssueTypes(id, [id]), { reorder_issue_types: [issueType] }, { projectId: compact, orderedIds: [compact] }],
  ] as const)("%s sends compact allowed variables and preserves returned selections", async (_label, write, data, variables) => {
    const mutate = stubWrite(data);
    const result = await write();
    expect(mutate.mock.calls[0][0].variables).toEqual(variables);
    const row = Array.isArray(result) ? result[0] : result;
    expect(row).toMatchObject({ id, project: id, created_at: "2026-10-11T10:00:00Z" });
    if ("level" in row) expect(row).toMatchObject({ start_state: null, is_pathfind: false, workflow_revision: 4 });
  });

  it.each([
    ["start state", () => setIssueTypeWorkflowStartState(id, id, 7), { id: compact, startStateId: compact, workflowRevision: 7 }],
    ["transition create", () => addIssueTypeWorkflowTransition(id, { from_state_id: id, to_state_id: id, agent_allowed: true, handoff: false, workflow_revision: 7, protected: true } as never), { issueTypeId: compact, fromStateId: compact, toStateId: compact, agentAllowed: true, handoff: false, workflowRevision: 7 }],
    ["transition update", () => updateIssueTypeWorkflowTransition(id, id, id, false, true, 7), { issueTypeId: compact, fromStateId: compact, toStateId: compact, agentAllowed: false, handoff: true, workflowRevision: 7 }],
    ["transition delete", () => removeIssueTypeWorkflowTransition(id, id, id, 7), { issueTypeId: compact, fromStateId: compact, toStateId: compact, workflowRevision: 7 }],
    ["state removal", () => removeIssueTypeWorkflowState(id, id, 7), { issueTypeId: compact, stateId: compact, workflowRevision: 7 }],
    ["auto-start", () => setIssueTypeWorkflowAutoStart(id, id, true, 7), { issueTypeId: compact, stateId: compact, autoStart: true, workflowRevision: 7 }],
    ["subtree run", () => setIssueTypeWorkflowSubtreeRun(id, id, true, 7), { issueTypeId: compact, stateId: compact, enabled: true, workflowRevision: 7 }],
  ] as const)("%s preserves the workflow revision guard", async (_label, write, variables) => {
    const mutate = stubWrite({});
    await write();
    expect(mutate.mock.calls[0][0].variables).toEqual(variables);
  });


  it.each([false, true])("launch binding resolves compact catalog IDs and preserves partial-edit fields (explicit fields: %s)", async (explicit) => {
    const mutate = stubWrite({ upsert_issue_type_launch_binding: { id: 1, stage_skills: [], profile: null } });
    vi.spyOn(studioApolloClient(), "readQuery").mockReturnValue({
      states: { nodes: [] }, issue_types: { nodes: [] },
      provider_catalog: {
        providers: [{ id: compact, slug: "codex" }], configurable_providers: [],
        agent_models: [{ id: compact, name: "model", provider: compact }],
        reasoning_levels: [{ id: compact, name: "high" }], global_default: null,
      },
    } as never);
    const binding = { agent: "codex", model: "model", reasoning: "high", protected: true,
      ...(explicit ? { prompt: "", required_skills: [], stage_skills: ["review"], profile: "profile" } : {}),
    };
    await upsertIssueTypeWorkflowLaunchBinding(id, id, id, binding, 8, true, false);
    expect(mutate.mock.calls[0][0].variables).toEqual({
      issueTypeId: compact, stateId: compact, workflowRevision: 8,
      modelId: compact, reasoningId: compact, autoStart: true, subtreeRunEnabled: false,
      ...(explicit ? { prompt: "", requiredSkills: [], stageSkills: ["review"], profile: "profile" } : {}),
    });
  });

});
