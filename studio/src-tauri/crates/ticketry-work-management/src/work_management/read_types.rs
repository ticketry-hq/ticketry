use serde::Serialize;
use ticketry_entities::StringList;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub onboarding_required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub sequence_id: i32,
    pub key: String,
    pub is_archived: bool,
    pub issue_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorkItem {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub sequence_id: i32,
    pub state: Option<String>,
    pub state_revision: i64,
    pub description: String,
    pub parent_id: Option<String>,
    pub module_id: Option<String>,
    pub sub_issues_count: i32,
    pub key: String,
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
    pub rank: String,
    pub issue_type: String,
    pub blocked_by_ids: StringList,
    pub blocks_ids: StringList,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct State {
    pub id: String,
    pub project: String,
    pub name: String,
    pub group: String,
    pub color: String,
    pub sort_order: i32,
    pub is_protected: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct IssueType {
    pub id: String,
    pub project: String,
    pub name: String,
    pub level: String,
    pub color: String,
    pub sort_order: i32,
    pub start_state: Option<String>,
    pub workflow_revision: i32,
    pub is_pathfind: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct IssueTypeTransition {
    pub id: i64,
    pub issue_type: String,
    pub from_state: String,
    pub to_state: String,
    pub agent_allowed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LaunchBinding {
    pub id: i64,
    pub issue_type: String,
    pub state: String,
    pub prompt: String,
    pub required_skills: StringList,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub auto_start: bool,
    pub subtree_run_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Provider {
    pub id: String,
    pub slug: String,
    pub activated: bool,
    pub supports_unattended: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReasoningLevel {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AgentModel {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub permitted_reasoning_levels: StringList,
}
