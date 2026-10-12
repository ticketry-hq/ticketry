import { projectOpenFixture } from "./projectOpenFixture";

/**
 * Server rows for the workflow catalog, which Studio reads from the project
 * open query: its states and issue types (with their workflow relations).
 */
export function workflowStateRow(
  id: string,
  name: string,
  sortOrder: number,
  group = "unstarted",
) {
  return {
    __typename: "WorktrackerState",
    id,
    project: "p1",
    name,
    group,
    color: "#888888",
    sort_order: sortOrder,
    is_protected: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

export function workflowIssueTypeRow(
  id: string,
  name: string,
  sortOrder: number,
  workflowRevision = 1,
) {
  return {
    __typename: "WorktrackerIssuetype",
    id,
    project: "p1",
    name,
    level: "task",
    color: "#888888",
    sort_order: sortOrder,
    start_state: null as string | null,
    workflow_revision: workflowRevision,
    is_pathfind: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    transitions: {
      __typename: "WorktrackerIssuetypetransitionConnection",
      nodes: [] as ReturnType<typeof workflowTransitionRow>[],
    },
    launch_bindings: {
      __typename: "WorktrackerLaunchbindingConnection",
      nodes: [] as ReturnType<typeof workflowLaunchBindingRow>[],
    },
  };
}

/** One transition row on an issue type's workflow. */
export function workflowTransitionRow(
  id: number,
  issueTypeId: string,
  fromStateId: string,
  toStateId: string,
  policy: { agentAllowed?: boolean; handoff?: boolean } = {},
) {
  return {
    __typename: "WorktrackerIssuetypetransition",
    id,
    issue_type: issueTypeId,
    from_state: fromStateId,
    to_state: toStateId,
    agent_allowed: policy.agentAllowed ?? true,
    handoff: policy.handoff ?? false,
    fromState: { __typename: "WorktrackerState", id: fromStateId, sort_order: 0 },
    toState: { __typename: "WorktrackerState", id: toStateId, sort_order: 1 },
  };
}

/** One state's launch binding row on an issue type's workflow. */
export function workflowLaunchBindingRow(
  id: number,
  issueTypeId: string,
  stateId: string,
  fields: Partial<{
    prompt: string;
    required_skills: string[];
    stage_skills: string[];
    profile: string | null;
    model: string | null;
    reasoning: string | null;
    auto_start: boolean;
    subtree_run_enabled: boolean;
  }> = {},
) {
  return {
    __typename: "WorktrackerLaunchbinding",
    id,
    issue_type: issueTypeId,
    state: stateId,
    prompt: "",
    required_skills: [],
    stage_skills: [],
    profile: null,
    model: null,
    reasoning: null,
    auto_start: false,
    subtree_run_enabled: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    state_record: { __typename: "WorktrackerState", id: stateId, sort_order: 0 },
    ...fields,
  };
}

/** An issue type row whose workflow carries these transitions and launch bindings. */
export function workflowIssueTypeWith(
  issueType: ReturnType<typeof workflowIssueTypeRow>,
  workflow: {
    startState?: string | null;
    workflowRevision?: number;
    transitions?: ReturnType<typeof workflowTransitionRow>[];
    launchBindings?: ReturnType<typeof workflowLaunchBindingRow>[];
  },
) {
  return {
    ...issueType,
    start_state: workflow.startState ?? issueType.start_state,
    workflow_revision: workflow.workflowRevision ?? issueType.workflow_revision,
    transitions: { ...issueType.transitions, nodes: workflow.transitions ?? [] },
    launch_bindings: { ...issueType.launch_bindings, nodes: workflow.launchBindings ?? [] },
  };
}

/** A `WorkTrackerProjectOpen` answer for project `p1` with this catalog. */
export function workflowCatalogAnswer(
  states: ReturnType<typeof workflowStateRow>[],
  issueTypes: ReturnType<typeof workflowIssueTypeRow>[] = [],
) {
  const { data } = projectOpenFixture(
    { id: "p1", name: "One", slug: "ONE", description: "" },
    [],
  );
  return {
    ...data,
    states: { __typename: "WorktrackerStateConnection", nodes: states },
    issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: issueTypes },
    provider_catalog: { ...data.provider_catalog, codex_profiles: [] },
  };
}

/** A `WorkTrackerWorkItems` answer: one task per state id, for state counts. */
export function projectItemsAnswer(stateIds: readonly string[]) {
  return {
    work_items: {
      __typename: "WorktrackerIssueConnection",
      nodes: stateIds.map((stateId, index) => ({
        __typename: "WorktrackerIssue",
        id: `item-${index + 1}`,
        name: `Item ${index + 1}`,
        project_id: "p1",
        sequence_id: index + 1,
        state_id: stateId,
        state_revision: 1,
        description: "",
        workspace_tab_order: [],
        parent_id: null,
        module_id: null,
        sprint_id: null,
        is_archived: false,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
        rank: String(index),
        issue_type_id: "t1",
        project: { __typename: "WorktrackerProject", id: "p1", slug: "ONE" },
        state_record: null,
        issue_type_record: null,
        children: { __typename: "WorktrackerIssueConnection", nodes: [] },
        blocked_by_edges: { __typename: "WorktrackerIssueBlockedByConnection", nodes: [] },
        blocks_edges: { __typename: "WorktrackerIssueBlockedByConnection", nodes: [] },
      })),
    },
  };
}
