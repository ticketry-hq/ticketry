export const PROJECT_ID = "11111111111111111111111111111111";
export const ISSUE_TYPE_ID = "22222222222222222222222222222222";
export const STATE_ID = "33333333333333333333333333333333";
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
export const workflowCatalog = {
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
    id: STATE_ID, project: PROJECT_ID, name: "Implement", group: "started",
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
      prompt: "Implement it.", entry_skill: null, required_skills: ["tdd"],
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
