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
    /// Onboarding lives on Project and the Workspace table is gone.
    ProjectOnly,
}

/// Which shape of the launch-binding row a database is in.
///
/// Adoption runs before the entry-skill migration on a first launch and after
/// it on every launch that follows, so both shapes are recognized rather than
/// one of them being refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaunchBindingShape {
    /// The launch binding has no entry skill yet.
    WithoutEntrySkill,
    /// The launch binding carries its nullable entry skill.
    WithEntrySkill,
}

/// The tables and columns Rust commands may mutate in `generation`.
#[must_use]
pub fn owned_tables(
    generation: SchemaGeneration,
    launch_binding: LaunchBindingShape,
) -> Vec<(&'static str, &'static [&'static str])> {
    let mut tables = match generation {
        SchemaGeneration::WorkspaceOwned => vec![WORKSPACE, PROJECT_UNDER_WORKSPACE],
        SchemaGeneration::ProjectOnly => vec![PROJECT_ONLY],
    };
    tables.extend_from_slice(SHARED_TABLES);
    tables.push(launch_binding_table(launch_binding));
    tables
}

/// The launch-binding columns of `shape`.
#[must_use]
pub fn launch_binding_table(
    shape: LaunchBindingShape,
) -> (&'static str, &'static [&'static str]) {
    match shape {
        LaunchBindingShape::WithoutEntrySkill => LAUNCH_BINDING,
        LaunchBindingShape::WithEntrySkill => LAUNCH_BINDING_WITH_ENTRY_SKILL,
    }
}

const LAUNCH_BINDING: (&str, &[&str]) = (
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
);

const LAUNCH_BINDING_WITH_ENTRY_SKILL: (&str, &[&str]) = (
    "worktracker_launchbinding",
    &[
        "id",
        "issue_type_id",
        "state_id",
        "prompt",
        "required_skills",
        "entry_skill",
        "auto_start",
        "created_at",
        "updated_at",
        "subtree_run_enabled",
        "model_id",
        "reasoning_id",
    ],
);

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
        let tables = owned_tables(
            SchemaGeneration::ProjectOnly,
            LaunchBindingShape::WithEntrySkill,
        );
        assert!(!tables.iter().any(|(table, _)| *table == WORKSPACE.0));
        let (_, columns) = tables
            .iter()
            .find(|(table, _)| *table == "worktracker_project")
            .expect("the project-only shape still owns Project");
        assert!(columns.contains(&"onboarding_required"));
        assert!(!columns.contains(&"workspace_id"));
    }

    /// The entry-skill column is the only difference between the two shapes.
    #[test]
    fn the_entry_skill_shape_adds_exactly_that_column() {
        let (without, before) = launch_binding_table(LaunchBindingShape::WithoutEntrySkill);
        let (with, after) = launch_binding_table(LaunchBindingShape::WithEntrySkill);
        assert_eq!(without, with);
        assert!(!before.contains(&"entry_skill"));
        assert!(after.contains(&"entry_skill"));
        let added = after
            .iter()
            .filter(|column| !before.contains(column))
            .collect::<Vec<_>>();
        assert_eq!(added, [&"entry_skill"]);
    }

    #[test]
    fn ownership_manifest_has_one_classification_per_table() {
        for generation in [
            SchemaGeneration::WorkspaceOwned,
            SchemaGeneration::ProjectOnly,
        ] {
            for launch_binding in [
                LaunchBindingShape::WithoutEntrySkill,
                LaunchBindingShape::WithEntrySkill,
            ] {
                for (table, columns) in owned_tables(generation, launch_binding) {
                    assert!(table.starts_with("worktracker_"));
                    assert!(!columns.is_empty());
                }
            }
        }
        let slice2_tables = crate::settings_persistence::ownership_manifest::owned_tables(
            LaunchBindingShape::WithEntrySkill,
        )
            .iter()
            .map(|(table, _)| *table)
            .collect::<std::collections::BTreeSet<_>>();
        assert!(slice2_tables.contains("worktracker_provider"));
        assert!(slice2_tables.contains("worktracker_agentmodel"));
        assert!(slice2_tables.contains("worktracker_reasoninglevel"));
    }
}
