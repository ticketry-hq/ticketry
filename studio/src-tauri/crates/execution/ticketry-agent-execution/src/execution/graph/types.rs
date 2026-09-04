use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphAccess {
    project_id: String,
    authorized_root_ids: Option<HashSet<String>>,
}

impl GraphAccess {
    pub fn project(project_id: impl Into<String>) -> Self {
        Self {
            project_id: compact_id(project_id.into()),
            authorized_root_ids: None,
        }
    }

    pub fn caller_roots(
        project_id: impl Into<String>,
        root_ids: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        Self {
            project_id: compact_id(project_id.into()),
            authorized_root_ids: Some(
                root_ids
                    .into_iter()
                    .map(|root_id| compact_id(root_id.into()))
                    .collect(),
            ),
        }
    }

    pub fn allows(&self, project_id: &str, root_id: &str) -> bool {
        self.project_id == project_id
            && self
                .authorized_root_ids
                .as_ref()
                .is_none_or(|roots| roots.contains(root_id))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DependencyGraphNode {
    pub id: String,
    pub state: String,
    pub parent_id: Option<String>,
    pub blocked_by: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DependencyGraph {
    pub root_id: String,
    pub nodes: Vec<DependencyGraphNode>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkItemFact {
    pub id: String,
    pub sequence_id: i32,
    pub state_name: Option<String>,
    pub state_group: Option<String>,
    pub is_archived: bool,
}

impl WorkItemFact {
    pub fn is_satisfied(&self) -> bool {
        self.is_archived
            || matches!(self.state_group.as_deref(), Some("completed" | "cancelled"))
            || self.state_name.as_deref() == Some("Review")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChildSchedulingFacts {
    pub child: WorkItemFact,
    pub blockers: Vec<WorkItemFact>,
    pub has_campaign_claim: bool,
    pub has_live_work: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionMode {
    Parallel,
    Serial,
}

pub fn compact_id(value: String) -> String {
    uuid::Uuid::parse_str(&value)
        .map(|identifier| identifier.simple().to_string())
        .unwrap_or(value)
}
