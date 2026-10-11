#![deny(private_bounds, private_interfaces)]

//! Work Items and the Modules they hang off: the planning model of Ticketry.
//!
//! `work_management` owns the Work Item, its Project, Issue Types, states and
//! workflow, launch policy, and the migrations that keep all of it adopted.
//! `module_links` owns the one thing a Module points at outside the database —
//! the folder on this machine that a launch will run in — which is why it is a
//! sibling here rather than a stranger somewhere else.

mod module_links;
mod work_management;

// Implementation paths stay private. External callers use only the approved
// capabilities explicitly re-exported from this root.
/// Register the authored Module Link GraphQL reads and restricted mutations.
pub use module_links::register_graphql;
pub use module_links::{
    import, rollback, ImportOutcome, ImportReceipt, LinkStatus, LocalModulePath, LocalPathDefect,
    ModuleFolderRefusal, ModuleLinkError, ModuleLinkErrorCode, ModuleLinkRecord, ModuleLinkStore,
    RollbackOutcome, SkipReason, FOLDER_INVALID, NOT_LINKED, STORE_UNAVAILABLE,
};
pub use work_management::workspace_tab_order::update as update_workspace_tab_order;
pub use work_management::{
    begin_write, install_sprint_execution_schema, open, open_established, open_for_commands,
    record_in, state_database_path, ReadDatabaseError,
};

/// Validate and migrate persistence for desktop startup.
pub use work_management::adoption::ensure_adopted;

/// Project-scoped sprint suggestion reads and agent recording.
pub use work_management::commands::sprint_suggestions::{
    goals_for_sprint, record_for_run, RecordSprintSuggestion, SprintStorySuggestion,
};

// Explicit capabilities preserve signatures without exposing implementation
// namespaces or adding forwarding behavior.
pub use module_links::folder_preflight::{
    validate_configured as validate_configured_module_folder, ModuleFolderFailure,
};
pub use module_links::identity::link_id_for_module;
pub use module_links::legacy_source::{
    locate as locate_legacy_module_links, read as read_legacy_module_links, LegacySource,
    PRESERVED_PROFILES,
};
pub use module_links::ownership_manifest::{
    owned_tables as module_links_owned_tables, OWNED_TABLES as MODULE_LINKS_OWNED_TABLES,
};
pub use module_links::receipt::{ImportedLink, ReceiptSource, SkippedLink, RECEIPT_FILE};
pub use module_links::resolution::{linked_folder, resolved_folder, usable_folder};
pub use module_links::schema::{
    install as install_module_links_schema, verify as verify_module_links_schema,
};
pub use module_links::store::PreparedModuleLink;
#[cfg(feature = "test-support")]
/// Individually named sibling-test fixtures, absent from normal builds.
pub use module_links::test_support::{
    install as install_module_link_test_schema, link as create_module_link_test_link,
    module as create_module_link_test_module,
};
pub use work_management::adoption::{adopt, AdoptionError, AdoptionEvidence, SourceClassification};
pub use work_management::commands::attachments::{
    create as create_attachment, list as list_attachments, AttachmentStorage, CreateAttachment,
};
pub use work_management::commands::blockers::{
    change as change_blockers, list as list_blockers, replace as replace_blockers, BlockerChange,
};
pub use work_management::commands::catalog::{
    acknowledge_onboarding, create_project, create_state, reorder_states, update_issue_type,
    update_state, CreateProject, CreateState, UpdateIssueType, UpdateState,
};
pub use work_management::commands::hierarchy::{reparent as reparent_work_item, ReparentWorkItem};
pub use work_management::commands::reorder::{
    reorder_module_presentation, reorder_work_item, ReorderWorkItem,
};
pub use work_management::commands::sprint_selector::SprintSelector;
pub use work_management::commands::sprints::plan_work_item as update_work_item_sprint;
pub use work_management::commands::state_configuration::delete_state;
pub use work_management::commands::status_facts::WorkFactRecorder;
pub use work_management::commands::tags::add as add_tag;
pub use work_management::commands::work_items::{
    append_description, archive as archive_work_item, create as create_work_item,
    create_review_finding, delete as delete_work_item, update as update_work_item,
    AppendDescription, CreateReviewFinding, CreateWorkItem, UpdateWorkItem,
};
pub use work_management::commands::workflow::{
    create_transition, delete_launch_binding, delete_transition, patch_launch_binding,
    refuse_run_now_with_subtasks, run_now_destination_type, transition,
    transition_with_expectation, update_transition, NewTransition, PatchLaunchBinding, PatchValue,
    RevisionedState, RevisionedTransition, TransitionCausation, TransitionExpectation,
    TransitionOrigin, TransitionPatch, TransitionWorkItem,
};
pub use work_management::commands::{CommandDatabase, CommandError};
pub use work_management::graphql::{
    apply_generated_input_policy, register as register_work_management_graphql,
    register_model_mutations,
};
pub use work_management::launch_binding::skill_availability::{
    check_launch_skill_availability, LaunchSkillAvailability, LaunchSkillAvailabilityRequest,
};
pub use work_management::launch_binding_entry_skill_migration::{
    install as install_launch_binding_entry_skill_schema,
    LEDGER_TABLE as LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_MIGRATION_ID,
    VERSION as LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_VERSION,
};
pub use work_management::launch_binding_profile_migration::{
    install as install_launch_binding_profile_schema,
    LEDGER_TABLE as LAUNCH_BINDING_PROFILE_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as LAUNCH_BINDING_PROFILE_MIGRATION_MIGRATION_ID,
    VERSION as LAUNCH_BINDING_PROFILE_MIGRATION_VERSION,
};
pub use work_management::launch_binding_stage_skills_migration::{
    install as install_launch_binding_stage_skills_schema,
    LEDGER_TABLE as LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_MIGRATION_ID,
    VERSION as LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_VERSION,
};
pub use work_management::launch_policy::{
    load_by_identity, mark_delivered, pending, prepare_pending_auto_starts,
    prepare_pending_retries, record, rejections_for_work_item, CallerScope, LaunchPolicyDecision,
    LaunchPolicyError, LaunchPolicyRejection, LaunchPolicyRequest, LaunchPolicyResolver,
    ModuleLinkInput,
};
pub use work_management::module_presentation_migration::{
    install as install_module_presentation_schema,
    LEDGER_TABLE as MODULE_PRESENTATION_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as MODULE_PRESENTATION_MIGRATION_MIGRATION_ID,
    VERSION as MODULE_PRESENTATION_MIGRATION_VERSION,
};
pub use work_management::ownership_manifest::VERSION as WORK_MANAGEMENT_OWNERSHIP_VERSION;
pub use work_management::project_onboarding_migration::{
    install as install_project_onboarding_schema, installation_project_id,
    LEDGER_TABLE as PROJECT_ONBOARDING_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as PROJECT_ONBOARDING_MIGRATION_MIGRATION_ID,
    SOURCE_COMMIT as PROJECT_ONBOARDING_MIGRATION_SOURCE_COMMIT,
    VERSION as PROJECT_ONBOARDING_MIGRATION_VERSION,
};
pub use work_management::read_queries::{
    agent_models, installation_project, issue_type, issue_types, launch_bindings, modules,
    projects, providers, reasoning_levels, states, transitions, work_item, work_items,
    ReadDatabase,
};
pub use work_management::read_types::{
    AgentModel, IssueType, IssueTypeTransition, LaunchBinding, Module, Project, Provider,
    ReasoningLevel, State, WorkItem,
};
pub use work_management::sprint_migration::{
    install as install_sprint_schema, LEDGER_TABLE as SPRINT_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as SPRINT_MIGRATION_MIGRATION_ID, VERSION as SPRINT_MIGRATION_VERSION,
};
pub use work_management::sprint_rank_migration::{
    install as install_sprint_rank_schema, LEDGER_TABLE as SPRINT_RANK_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as SPRINT_RANK_MIGRATION_MIGRATION_ID, VERSION as SPRINT_RANK_MIGRATION_VERSION,
};
pub use work_management::tag_migration::{
    install as install_tag_schema, LEDGER_TABLE as TAG_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as TAG_MIGRATION_MIGRATION_ID, VERSION as TAG_MIGRATION_VERSION,
};
pub use work_management::workflow_color_migration::{
    install as install_workflow_color_schema,
    LEDGER_TABLE as WORKFLOW_COLOR_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as WORKFLOW_COLOR_MIGRATION_MIGRATION_ID,
    SOURCE_COMMIT as WORKFLOW_COLOR_MIGRATION_SOURCE_COMMIT,
    VERSION as WORKFLOW_COLOR_MIGRATION_VERSION,
};
pub use work_management::workflow_handoff_migration::{
    install as install_workflow_handoff_schema,
    LEDGER_TABLE as WORKFLOW_HANDOFF_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as WORKFLOW_HANDOFF_MIGRATION_MIGRATION_ID,
};
pub use work_management::workspace_tab_order_migration::{
    install as install_workspace_tab_order_schema,
    LEDGER_TABLE as WORKSPACE_TAB_ORDER_MIGRATION_LEDGER_TABLE,
    MIGRATION_ID as WORKSPACE_TAB_ORDER_MIGRATION_MIGRATION_ID,
    SOURCE_COMMIT as WORKSPACE_TAB_ORDER_MIGRATION_SOURCE_COMMIT,
    VERSION as WORKSPACE_TAB_ORDER_MIGRATION_VERSION,
};

pub use work_management::commands::default_project_catalog::seed as seed_default_project_catalog;
