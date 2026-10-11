//! External compile conformance for the approved work-management root seam.
//! Consumer migration is complete; implementation namespaces remain private.
#![allow(unused_imports)]

use ticketry_work_management::{
    acknowledge_onboarding, add_tag, adopt, agent_models, append_description,
    apply_generated_input_policy, archive_work_item, change_blockers,
    check_launch_skill_availability, create_attachment, create_project, create_review_finding,
    create_state, create_transition, create_work_item, delete_launch_binding, delete_state,
    delete_transition, delete_work_item, install_launch_binding_entry_skill_schema,
    install_launch_binding_profile_schema, install_launch_binding_stage_skills_schema,
    install_module_links_schema, install_module_presentation_schema,
    install_project_onboarding_schema, install_sprint_schema, install_tag_schema,
    install_workflow_color_schema, install_workflow_handoff_schema,
    install_workspace_tab_order_schema, installation_project, installation_project_id, issue_type,
    issue_types, launch_bindings, link_id_for_module, linked_folder, list_attachments,
    list_blockers, load_by_identity, locate_legacy_module_links, mark_delivered,
    module_links_owned_tables, modules, patch_launch_binding, pending, prepare_pending_auto_starts,
    prepare_pending_retries, projects, providers, read_legacy_module_links, reasoning_levels,
    record, refuse_run_now_with_subtasks, register_model_mutations,
    register_work_management_graphql, rejections_for_work_item, reorder_module_presentation,
    reorder_states, reorder_work_item, reparent_work_item, replace_blockers, resolved_folder,
    run_now_destination_type, seed_default_project_catalog, states, transition,
    transition_with_expectation, transitions, update_issue_type, update_state, update_transition,
    update_work_item, usable_folder, validate_configured_module_folder, verify_module_links_schema,
    work_item, work_items, AdoptionError, AdoptionEvidence, AgentModel, AppendDescription,
    AttachmentStorage, BlockerChange, CallerScope, CommandDatabase, CommandError, CreateAttachment,
    CreateProject, CreateReviewFinding, CreateState, CreateWorkItem, ImportedLink, IssueType,
    IssueTypeTransition, LaunchBinding, LaunchPolicyDecision, LaunchPolicyError,
    LaunchPolicyRejection, LaunchPolicyRequest, LaunchPolicyResolver, LaunchSkillAvailability,
    LaunchSkillAvailabilityRequest, LegacySource, Module, ModuleFolderFailure, ModuleLinkInput,
    NewTransition, PatchLaunchBinding, PatchValue, PreparedModuleLink, Project, Provider,
    ReadDatabase, ReasoningLevel, ReceiptSource, ReorderWorkItem, ReparentWorkItem,
    RevisionedState, RevisionedTransition, SkippedLink, SourceClassification, State,
    TransitionCausation, TransitionExpectation, TransitionOrigin, TransitionPatch,
    TransitionWorkItem, UpdateIssueType, UpdateState, UpdateWorkItem, WorkFactRecorder, WorkItem,
    LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_LEDGER_TABLE,
    LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_MIGRATION_ID,
    LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_VERSION, LAUNCH_BINDING_PROFILE_MIGRATION_LEDGER_TABLE,
    LAUNCH_BINDING_PROFILE_MIGRATION_MIGRATION_ID, LAUNCH_BINDING_PROFILE_MIGRATION_VERSION,
    LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_LEDGER_TABLE,
    LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_MIGRATION_ID,
    LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_VERSION, MODULE_LINKS_OWNED_TABLES,
    MODULE_PRESENTATION_MIGRATION_LEDGER_TABLE, MODULE_PRESENTATION_MIGRATION_MIGRATION_ID,
    MODULE_PRESENTATION_MIGRATION_VERSION, PRESERVED_PROFILES,
    PROJECT_ONBOARDING_MIGRATION_LEDGER_TABLE, PROJECT_ONBOARDING_MIGRATION_MIGRATION_ID,
    PROJECT_ONBOARDING_MIGRATION_SOURCE_COMMIT, PROJECT_ONBOARDING_MIGRATION_VERSION, RECEIPT_FILE,
    SPRINT_MIGRATION_LEDGER_TABLE, SPRINT_MIGRATION_MIGRATION_ID, SPRINT_MIGRATION_VERSION,
    TAG_MIGRATION_LEDGER_TABLE, TAG_MIGRATION_MIGRATION_ID, TAG_MIGRATION_VERSION,
    WORKFLOW_COLOR_MIGRATION_LEDGER_TABLE, WORKFLOW_COLOR_MIGRATION_MIGRATION_ID,
    WORKFLOW_COLOR_MIGRATION_SOURCE_COMMIT, WORKFLOW_COLOR_MIGRATION_VERSION,
    WORKFLOW_HANDOFF_MIGRATION_LEDGER_TABLE, WORKFLOW_HANDOFF_MIGRATION_MIGRATION_ID,
    WORKSPACE_TAB_ORDER_MIGRATION_LEDGER_TABLE, WORKSPACE_TAB_ORDER_MIGRATION_MIGRATION_ID,
    WORKSPACE_TAB_ORDER_MIGRATION_SOURCE_COMMIT, WORKSPACE_TAB_ORDER_MIGRATION_VERSION,
    WORK_MANAGEMENT_OWNERSHIP_VERSION,
};

#[test]
fn outside_callers_can_use_root_capabilities_and_typed_refusals() {
    assert_eq!(
        validate_configured_module_folder(None),
        Err(ModuleFolderFailure::Unset)
    );
    let unset: PatchValue<String> = PatchValue::Unset;
    assert!(matches!(unset, PatchValue::Unset));
}

#[cfg(feature = "test-support")]
#[test]
fn sibling_fixtures_have_individually_named_root_capabilities() {
    use ticketry_work_management::{
        create_module_link_test_link, create_module_link_test_module,
        install_module_link_test_schema,
    };
    let _ = (
        create_module_link_test_link,
        create_module_link_test_module,
        install_module_link_test_schema,
    );
}
