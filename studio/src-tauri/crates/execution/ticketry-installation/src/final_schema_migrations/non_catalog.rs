//! Installation-owned steps, retaining their historical positions and labels.

use sea_orm::{DatabaseConnection, DbErr};
use ticketry_work_management::{
    launch_binding_entry_skill_migration, launch_binding_profile_migration,
    launch_binding_stage_skills_migration, module_presentation_migration,
    project_onboarding_migration, sprint_migration, tag_migration, workflow_color_migration,
    workflow_handoff_migration, workspace_tab_order_migration,
};
use ticketry_workspace_runtime::persistence::{pull_request_url_migration, ship_record_migration};

pub(super) struct NonCatalogStep {
    pub(super) step: u32,
    pub(super) label: &'static str,
    pub(super) migration_id: Option<&'static str>,
    pub(super) runner: NonCatalogMigration,
}

// Keep positions, identities, and executable steps in a single declaration.
macro_rules! non_catalog_steps {
    ($($variant:ident: ($step:literal, $label:literal, $id:expr, $install:path)),+ $(,)?) => {
        #[derive(Clone, Copy)]
        pub(super) enum NonCatalogMigration { $($variant),+ }

        pub(super) const NON_CATALOG_STEPS: &[NonCatalogStep] = &[
            $(NonCatalogStep {
                step: $step, label: $label, migration_id: $id,
                runner: NonCatalogMigration::$variant,
            }),+
        ];

        impl NonCatalogMigration {
            pub(super) async fn install(self, database: &DatabaseConnection) -> Result<(), DbErr> {
                match self { $(Self::$variant => $install(database).await),+ }
            }
        }
    };
}

non_catalog_steps! {
    ProjectOnboarding: (45, "0045-0046", Some(project_onboarding_migration::MIGRATION_ID), project_onboarding_migration::install),
    EntrySkill: (47, "0047", Some(launch_binding_entry_skill_migration::MIGRATION_ID), launch_binding_entry_skill_migration::install),
    WorkflowColor: (48, "0048", Some(workflow_color_migration::MIGRATION_ID), workflow_color_migration::install),
    WorkspaceTabOrder: (49, "0049", Some(workspace_tab_order_migration::MIGRATION_ID), workspace_tab_order_migration::install),
    ModulePresentation: (50, "0050", Some(module_presentation_migration::MIGRATION_ID), module_presentation_migration::install),
    PullRequestUrl: (52, "0052", Some(pull_request_url_migration::MIGRATION_ID), pull_request_url_migration::install),
    WorkflowHandoff: (53, "0053", Some(workflow_handoff_migration::MIGRATION_ID), workflow_handoff_migration::install),
    LaunchProfile: (56, "0056", Some(launch_binding_profile_migration::MIGRATION_ID), launch_binding_profile_migration::install),
    ShipRecord: (58, "0058", Some(ship_record_migration::MIGRATION_ID), ship_record_migration::install),
    StageSkills: (59, "0059", Some(launch_binding_stage_skills_migration::MIGRATION_ID), launch_binding_stage_skills_migration::install),
    Tags: (60, "0060", Some(tag_migration::MIGRATION_ID), tag_migration::install),
    Sprints: (63, "0063", Some(sprint_migration::MIGRATION_ID), sprint_migration::install),
    SprintExecution: (64, "0064-exec", None, ticketry_work_management::install_sprint_execution_schema),
}
