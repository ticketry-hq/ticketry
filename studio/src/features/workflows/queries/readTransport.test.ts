import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedWorkTrackerStateFieldsFragment } from "../../projects/generated/projects.documents";
import {
  readSubtreeRunCapabilities,
  readWorkflowIssueTypes,
  readWorkflowSettings,
  readWorkflowStates,
} from "./readTransport";

const apollo = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../shared/apollo/client", async () => {
  const { ApolloClient, ApolloLink, InMemoryCache } = await import("@apollo/client");
  const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() });
  client.query = apollo.query;
  return { studioApolloClient: () => client, resetStudioApolloClient: () => client.clearStore() };
});

const project = "11111111-1111-1111-1111-111111111111";
const issueType = "22222222-2222-2222-2222-222222222222";
const start = "33333333-3333-3333-3333-333333333333";
const done = "44444444-4444-4444-4444-444444444444";
const compact = (id: string) => id.replace(/-/g, "");
const timestamp = "2026-10-10T10:00:00";

function catalog() {
  return {
    project: { nodes: [{ id: compact(project), name: "Project", slug: "TEST", description: "", created_at: timestamp }] },
    modules: { nodes: [] },
    module_presentations: { nodes: [] },
    states: { nodes: [] as GeneratedWorkTrackerStateFieldsFragment[] },
    issue_types: { nodes: [{
      id: compact(issueType), project: compact(project), name: "Story", level: "task", color: "#fff",
      sort_order: 0, start_state: null as string | null, workflow_revision: 7, is_pathfind: false,
      created_at: timestamp, updated_at: timestamp,
      transitions: { nodes: [{ id: 1, issue_type: compact(issueType), from_state: compact(start), to_state: compact(done), agent_allowed: true, handoff: false, fromState: { id: compact(start), sort_order: 0 }, toState: { id: compact(done), sort_order: 1 } }] },
      launch_bindings: { nodes: [{ id: 2, issue_type: compact(issueType), state: compact(start), prompt: "Implement", required_skills: ["tdd"], stage_skills: [], profile: null, model: null, reasoning: null, auto_start: false, subtree_run_enabled: true, created_at: timestamp, updated_at: timestamp, state_record: { id: compact(start), sort_order: 0 } }] },
    }] },
    provider_catalog: { providers: [], configurable_providers: [], agent_models: [], reasoning_levels: [], global_default: null },
  };
}

describe("workflow read feature I/O", () => {
  beforeEach(() => apollo.query.mockReset());

  it("retains generated nested relationships and converts aliased identifiers while keeping a null start state", async () => {
    apollo.query.mockResolvedValue({ data: catalog() });

    const [type] = await readWorkflowIssueTypes(project);

    expect(type).toMatchObject({
      id: issueType, project, level: "task", start_state: null,
      created_at: `${timestamp}Z`, updated_at: `${timestamp}Z`,
      transitions: { nodes: [{ issue_type: issueType, from_state: start, to_state: done, fromState: { id: start }, toState: { id: done } }] },
      launch_bindings: { nodes: [{ issue_type: issueType, state: start, state_record: { id: start }, created_at: `${timestamp}Z` }] },
    });
    expect(apollo.query).toHaveBeenCalledWith(expect.objectContaining({ variables: { projectId: compact(project) } }));
  });

  it("orders states and issue types by sort order then creation time and returns complete generated state rows", async () => {
    const data = catalog();
    const state = (id: string, sort_order: number, created_at: string) => ({
      id: compact(id), project: compact(project), name: id, group: "started", color: "#fff",
      sort_order, is_protected: true, created_at, updated_at: timestamp,
    });
    const earlier = "55555555-5555-5555-5555-555555555555";
    data.states.nodes = [
      state(done, 1, timestamp), state(start, 0, timestamp),
      state(earlier, 0, "2026-10-09T10:00:00"),
    ];
    const template = data.issue_types.nodes[0];
    data.issue_types.nodes = [
      { ...template, id: compact(done), sort_order: 1 },
      { ...template, id: compact(start), sort_order: 0 },
      { ...template, id: compact(earlier), sort_order: 0, created_at: "2026-10-09T10:00:00" },
    ];
    apollo.query.mockResolvedValue({ data });

    const states = await readWorkflowStates(project);
    const types = await readWorkflowIssueTypes(project);

    expect(states.map((row) => row.id)).toEqual([earlier, start, done]);
    expect(types.map((row) => row.id)).toEqual([earlier, start, done]);
    expect(states[0]).toMatchObject({ project, is_protected: true, sort_order: 0, created_at: "2026-10-09T10:00:00Z", updated_at: `${timestamp}Z` });
  });

  it("preserves scoped transitions, revision and subtree capability derivation from converted bindings", async () => {
    const data = catalog();
    data.issue_types.nodes[0].start_state = compact(start);
    const enabled = data.issue_types.nodes[0].launch_bindings.nodes[0];
    data.issue_types.nodes[0].launch_bindings.nodes.push({
      ...enabled, id: 3, state: compact(done), subtree_run_enabled: false,
      state_record: { id: compact(done), sort_order: 1 },
    });
    apollo.query.mockResolvedValue({ data });

    const settings = await readWorkflowSettings(project, issueType, "network-only");
    const capabilities = await readSubtreeRunCapabilities(project);

    expect(settings).toMatchObject({
      issue_type_id: issueType, start_state_id: start, workflow_revision: 7,
      transitions: [{ from_state_id: start, to_state_id: done, agent_allowed: true, handoff: false }],
      launch_bindings: [{ state_id: start, required_skills: ["tdd"], subtree_run_enabled: true }, { state_id: done, subtree_run_enabled: false }],
    });
    expect(capabilities).toEqual({ [issueType]: [start] });
    expect(apollo.query).toHaveBeenCalledWith(expect.objectContaining({ fetchPolicy: "network-only", context: { queryDeduplication: false }, variables: { projectId: compact(project) } }));
  });
});
