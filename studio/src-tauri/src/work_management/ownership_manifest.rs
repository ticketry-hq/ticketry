//! Checked write-ownership closure for the WorkTracker cutover.

pub const VERSION: i32 = 1;
pub const CURRENT_DJANGO_LEAF: &str = "0042_merge_singular_idea_state";

/// Tables Rust commands may mutate after the one-writer handoff.
pub const OWNED_TABLES: &[(&str, &[&str])] = &[
    (
        "worktracker_workspace",
        &[
            "id",
            "slug",
            "name",
            "onboarding_required",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "worktracker_project",
        &[
            "id",
            "workspace_id",
            "name",
            "slug",
            "description",
            "seq_counter",
            "state_revision",
            "manual_module_order",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "worktracker_state",
        &[
            "id",
            "project_id",
            "name",
            "group",
            "color",
            "sort_order",
            "is_protected",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "worktracker_issuetype",
        &[
            "id",
            "project_id",
            "name",
            "level",
            "color",
            "sort_order",
            "start_state_id",
            "workflow_revision",
            "is_pathfind",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "worktracker_issuetypetransition",
        &[
            "id",
            "issue_type_id",
            "from_state_id",
            "to_state_id",
            "agent_allowed",
        ],
    ),
    (
        "worktracker_launchbinding",
        &[
            "id",
            "issue_type_id",
            "state_id",
            "prompt",
            "required_skills",
            "auto_start",
            "created_at",
            "updated_at",
            "subtree_run_enabled",
            "model_id",
            "reasoning_id",
        ],
    ),
    (
        "worktracker_issue",
        &[
            "id",
            "project_id",
            "type",
            "issue_type_id",
            "parent_id",
            "module_id",
            "state_id",
            "state_revision",
            "name",
            "sequence_id",
            "is_archived",
            "rank",
            "description",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "worktracker_issue_blocked_by",
        &["id", "from_issue_id", "to_issue_id"],
    ),
    (
        "worktracker_attachment",
        &[
            "id",
            "issue_id",
            "file",
            "filename",
            "mime_type",
            "size",
            "created_at",
        ],
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_manifest_has_one_classification_per_table() {
        for (table, columns) in OWNED_TABLES {
            assert!(table.starts_with("worktracker_"));
            assert!(!columns.is_empty());
        }
        let slice2_tables = crate::settings_persistence::ownership_manifest::OWNED_TABLES
            .iter()
            .map(|(table, _)| *table)
            .collect::<std::collections::BTreeSet<_>>();
        assert!(slice2_tables.contains("worktracker_provider"));
        assert!(slice2_tables.contains("worktracker_agentmodel"));
        assert!(slice2_tables.contains("worktracker_reasoninglevel"));
    }
}
