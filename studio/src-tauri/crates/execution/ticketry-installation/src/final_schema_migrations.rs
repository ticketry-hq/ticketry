//! The post-adoption final-schema chain, in source order.
//!
//! The chain spans work management, settings, and worktree schemas, so it is
//! installation's to compose rather than any one of theirs to own.

use sea_orm::{DatabaseConnection, DbErr};

use ticketry_settings::{
    install_codex_5_6, install_codex_6_1_sol, install_codex_6_astra, install_codex_6_sol_luna,
    install_codex_astra, install_codex_glm_5_3_flash, install_codex_spark, CODEX_5_6_MIGRATION_ID,
    CODEX_6_1_SOL_MIGRATION_ID, CODEX_6_ASTRA_MIGRATION_ID, CODEX_6_SOL_LUNA_MIGRATION_ID,
    CODEX_ASTRA_MIGRATION_ID, CODEX_GLM_5_3_FLASH_MIGRATION_ID, CODEX_SPARK_MIGRATION_ID,
};
use ticketry_work_management::{
    install_launch_binding_entry_skill_schema, install_launch_binding_profile_schema,
    install_launch_binding_stage_skills_schema, install_module_presentation_schema,
    install_project_onboarding_schema, install_sprint_rank_schema, install_sprint_schema,
    install_tag_schema, install_workflow_color_schema, install_workflow_handoff_schema,
    install_workspace_tab_order_schema, LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_MIGRATION_ID,
    LAUNCH_BINDING_PROFILE_MIGRATION_MIGRATION_ID,
    LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_MIGRATION_ID, MODULE_PRESENTATION_MIGRATION_MIGRATION_ID,
    PROJECT_ONBOARDING_MIGRATION_MIGRATION_ID, SPRINT_MIGRATION_MIGRATION_ID,
    SPRINT_RANK_MIGRATION_MIGRATION_ID, TAG_MIGRATION_MIGRATION_ID,
    WORKFLOW_COLOR_MIGRATION_MIGRATION_ID, WORKFLOW_HANDOFF_MIGRATION_MIGRATION_ID,
    WORKSPACE_TAB_ORDER_MIGRATION_MIGRATION_ID,
};

pub const ORDERED_MIGRATION_IDS: &[&str] = &[
    CODEX_5_6_MIGRATION_ID,
    PROJECT_ONBOARDING_MIGRATION_MIGRATION_ID,
    LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_MIGRATION_ID,
    WORKFLOW_COLOR_MIGRATION_MIGRATION_ID,
    WORKSPACE_TAB_ORDER_MIGRATION_MIGRATION_ID,
    MODULE_PRESENTATION_MIGRATION_MIGRATION_ID,
    CODEX_SPARK_MIGRATION_ID,
    ticketry_workspace_runtime::PULL_REQUEST_URL_MIGRATION_ID,
    WORKFLOW_HANDOFF_MIGRATION_MIGRATION_ID,
    CODEX_ASTRA_MIGRATION_ID,
    CODEX_6_ASTRA_MIGRATION_ID,
    LAUNCH_BINDING_PROFILE_MIGRATION_MIGRATION_ID,
    CODEX_GLM_5_3_FLASH_MIGRATION_ID,
    ticketry_workspace_runtime::SHIP_RECORD_MIGRATION_ID,
    LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_MIGRATION_ID,
    TAG_MIGRATION_MIGRATION_ID,
    CODEX_6_SOL_LUNA_MIGRATION_ID,
    CODEX_6_1_SOL_MIGRATION_ID,
    SPRINT_MIGRATION_MIGRATION_ID,
    SPRINT_RANK_MIGRATION_MIGRATION_ID,
];

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    install_codex_5_6(database)
        .await
        .map_err(|error| step_error("0044", error))?;
    install_project_onboarding_schema(database)
        .await
        .map_err(|error| step_error("0045-0046", error))?;
    install_launch_binding_entry_skill_schema(database)
        .await
        .map_err(|error| step_error("0047", error))?;
    install_workflow_color_schema(database)
        .await
        .map_err(|error| step_error("0048", error))?;
    install_workspace_tab_order_schema(database)
        .await
        .map_err(|error| step_error("0049", error))?;
    install_module_presentation_schema(database)
        .await
        .map_err(|error| step_error("0050", error))?;
    install_codex_spark(database)
        .await
        .map_err(|error| step_error("0051", error))?;
    ticketry_workspace_runtime::install_pull_request_url_migration(database)
        .await
        .map_err(|error| step_error("0052", error))?;
    install_workflow_handoff_schema(database)
        .await
        .map_err(|error| step_error("0053", error))?;
    install_codex_astra(database)
        .await
        .map_err(|error| step_error("0054", error))?;
    install_codex_6_astra(database)
        .await
        .map_err(|error| step_error("0055", error))?;
    install_launch_binding_profile_schema(database)
        .await
        .map_err(|error| step_error("0056", error))?;
    install_codex_glm_5_3_flash(database)
        .await
        .map_err(|error| step_error("0057", error))?;
    ticketry_workspace_runtime::install_ship_record_migration(database)
        .await
        .map_err(|error| step_error("0058", error))?;
    install_launch_binding_stage_skills_schema(database)
        .await
        .map_err(|error| step_error("0059", error))?;
    install_tag_schema(database)
        .await
        .map_err(|error| step_error("0060", error))?;
    install_codex_6_sol_luna(database)
        .await
        .map_err(|error| step_error("0061", error))?;
    install_codex_6_1_sol(database)
        .await
        .map_err(|error| step_error("0062", error))?;
    install_sprint_schema(database)
        .await
        .map_err(|error| step_error("0063", error))?;
    ticketry_work_management::install_sprint_execution_schema(database)
        .await
        .map_err(|error| step_error("0064-exec", error))?;
    install_sprint_rank_schema(database)
        .await
        .map_err(|error| step_error("0065", error))
}

fn step_error(step: &str, error: DbErr) -> DbErr {
    DbErr::Custom(format!("final-schema migration {step} failed: {error}"))
}
