//! Checked write-ownership closure for the WorkTracker cutover.
//!
//! The closure has two shapes, because onboarding moved onto Project and the
//! Workspace table was removed after the handoff was designed. Adoption reads
//! the shape the database is actually in — the Workspace shape before that
//! migration, the project-only shape after it — so reopening a migrated
//! installation is recognized rather than refused.

pub const VERSION: i32 = 1;
pub const CURRENT_DJANGO_LEAF: &str = "0042_merge_singular_idea_state";

/// Which shape of the ownership closure a database is in.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SchemaGeneration {
    /// Onboarding still lives on a Workspace row that owns every project.
    WorkspaceOwned,
    /// Workspace-owned schema after the 0049 workspace-tab migration.
    WorkspaceOwnedWithTabOrder,
    /// Workspace-owned schema after ModulePresentation replaces the flag.
    WorkspaceOwnedWithTabOrderAndModulePresentation,
    /// Onboarding lives on Project and the Workspace table is gone.
    ProjectOnly,
    /// Project-only schema after the 0049 workspace-tab migration.
    ProjectOnlyWithTabOrder,
    /// Project-only schema after ModulePresentation replaces the flag.
    ProjectOnlyWithTabOrderAndModulePresentation,
}

/// The tables and columns Rust commands may mutate in `generation`.
#[must_use]
pub fn owned_tables(generation: SchemaGeneration) -> Vec<(&'static str, &'static [&'static str])> {
    let mut tables = match generation {
        SchemaGeneration::WorkspaceOwned | SchemaGeneration::WorkspaceOwnedWithTabOrder => {
            vec![WORKSPACE, PROJECT_UNDER_WORKSPACE]
        }
        SchemaGeneration::WorkspaceOwnedWithTabOrderAndModulePresentation => {
            vec![WORKSPACE, PROJECT_UNDER_WORKSPACE_WITH_PRESENTATION]
        }
        SchemaGeneration::ProjectOnly | SchemaGeneration::ProjectOnlyWithTabOrder => {
            vec![PROJECT_ONLY]
        }
        SchemaGeneration::ProjectOnlyWithTabOrderAndModulePresentation => {
            vec![PROJECT_ONLY_WITH_PRESENTATION]
        }
    };
    tables.extend_from_slice(SHARED_TABLES);
    if matches!(
        generation,
        SchemaGeneration::WorkspaceOwnedWithTabOrder
            | SchemaGeneration::WorkspaceOwnedWithTabOrderAndModulePresentation
            | SchemaGeneration::ProjectOnlyWithTabOrder
            | SchemaGeneration::ProjectOnlyWithTabOrderAndModulePresentation
    ) {
        let issue = tables
            .iter_mut()
            .find(|(table, _)| *table == "worktracker_issue")
            .expect("the ownership manifest includes Issue");
        *issue = ISSUE_WITH_TAB_ORDER;
    }
    if matches!(
        generation,
        SchemaGeneration::WorkspaceOwnedWithTabOrderAndModulePresentation
            | SchemaGeneration::ProjectOnlyWithTabOrderAndModulePresentation
    ) {
        tables.push(MODULE_PRESENTATION);
    }
    tables
}

/// The Workspace table, present only before onboarding moved onto Project.
const WORKSPACE: (&str, &[&str]) = (
    "worktracker_workspace",
    &[
        "id",
        "slug",
        "name",
        "onboarding_required",
        "created_at",
        "updated_at",
    ],
);

/// Project while a Workspace still owns it.
const PROJECT_UNDER_WORKSPACE: (&str, &[&str]) = (
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
);

const PROJECT_UNDER_WORKSPACE_WITH_PRESENTATION: (&str, &[&str]) = (
    "worktracker_project",
    &[
        "id",
        "workspace_id",
        "name",
        "slug",
        "description",
        "seq_counter",
        "state_revision",
        "created_at",
        "updated_at",
    ],
);

/// Project once it owns onboarding and no Workspace exists.
const PROJECT_ONLY: (&str, &[&str]) = (
    "worktracker_project",
    &[
        "id",
        "name",
        "slug",
        "description",
        "seq_counter",
        "state_revision",
        "manual_module_order",
        "created_at",
        "updated_at",
        "onboarding_required",
    ],
);

const PROJECT_ONLY_WITH_PRESENTATION: (&str, &[&str]) = (
    "worktracker_project",
    &[
        "id",
        "name",
        "slug",
        "description",
        "seq_counter",
        "state_revision",
        "created_at",
        "updated_at",
        "onboarding_required",
    ],
);

const MODULE_PRESENTATION: (&str, &[&str]) = (
    "worktracker_modulepresentation",
    &["module_id", "rank", "tab_hidden"],
);

const ISSUE_WITH_TAB_ORDER: (&str, &[&str]) = (
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
        "workspace_tab_order",
        "created_at",
        "updated_at",
    ],
);

/// Every other owned table, identical in both shapes.
const SHARED_TABLES: &[(&str, &[&str])] = &[
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
    fn the_project_only_shape_drops_workspace_and_owns_onboarding() {
        let tables = owned_tables(SchemaGeneration::ProjectOnly);
        assert!(!tables.iter().any(|(table, _)| *table == WORKSPACE.0));
        let (_, columns) = tables
            .iter()
            .find(|(table, _)| *table == "worktracker_project")
            .expect("the project-only shape still owns Project");
        assert!(columns.contains(&"onboarding_required"));
        assert!(!columns.contains(&"workspace_id"));
    }

    #[test]
    fn ownership_manifest_has_one_classification_per_table() {
        for generation in [
            SchemaGeneration::WorkspaceOwned,
            SchemaGeneration::WorkspaceOwnedWithTabOrder,
            SchemaGeneration::WorkspaceOwnedWithTabOrderAndModulePresentation,
            SchemaGeneration::ProjectOnly,
            SchemaGeneration::ProjectOnlyWithTabOrder,
            SchemaGeneration::ProjectOnlyWithTabOrderAndModulePresentation,
        ] {
            for (table, columns) in owned_tables(generation) {
                assert!(table.starts_with("worktracker_"));
                assert!(!columns.is_empty());
            }
        }
        let slice2_tables = ticketry_settings::ownership_manifest::OWNED_TABLES
            .iter()
            .map(|(table, _)| *table)
            .collect::<std::collections::BTreeSet<_>>();
        assert!(slice2_tables.contains("worktracker_provider"));
        assert!(slice2_tables.contains("worktracker_agentmodel"));
        assert!(slice2_tables.contains("worktracker_reasoninglevel"));
    }

    #[test]
    fn post_0049_shapes_own_the_workspace_tab_order_column() {
        for generation in [
            SchemaGeneration::WorkspaceOwnedWithTabOrder,
            SchemaGeneration::WorkspaceOwnedWithTabOrderAndModulePresentation,
            SchemaGeneration::ProjectOnlyWithTabOrder,
            SchemaGeneration::ProjectOnlyWithTabOrderAndModulePresentation,
        ] {
            let (_, columns) = owned_tables(generation)
                .into_iter()
                .find(|(table, _)| *table == "worktracker_issue")
                .unwrap();
            assert!(columns.contains(&"workspace_tab_order"));
        }
        let (_, baseline) = owned_tables(SchemaGeneration::ProjectOnly)
            .into_iter()
            .find(|(table, _)| *table == "worktracker_issue")
            .unwrap();
        assert!(!baseline.contains(&"workspace_tab_order"));
    }

    #[test]
    fn module_presentation_shapes_drop_the_project_flag_and_own_the_new_table() {
        for generation in [
            SchemaGeneration::WorkspaceOwnedWithTabOrderAndModulePresentation,
            SchemaGeneration::ProjectOnlyWithTabOrderAndModulePresentation,
        ] {
            let tables = owned_tables(generation);
            let (_, project_columns) = tables
                .iter()
                .find(|(table, _)| *table == "worktracker_project")
                .unwrap();
            assert!(!project_columns.contains(&"manual_module_order"));
            assert_eq!(
                tables
                    .iter()
                    .find(|(table, _)| *table == MODULE_PRESENTATION.0)
                    .map(|(_, columns)| *columns),
                Some(MODULE_PRESENTATION.1)
            );
        }
    }
}
