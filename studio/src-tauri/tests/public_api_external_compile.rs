//! Real external consumers are the authority for facade privacy and feature gates.
#[path = "public_api/external_consumer.rs"]
mod external_consumer;

use external_consumer::{Consumer, FIXTURE_ITEMS};

#[test]
fn external_consumers_use_approved_roots_and_cannot_name_implementation_paths() {
    let consumer = Consumer::build(false);
    consumer.accept_approved_roots(false);
    for (import, expected_item) in [
        (
            "ticketry_work_management::commands::CommandError",
            "commands",
        ),
        (
            "ticketry_work_management::read_queries::ReadDatabase",
            "read_queries",
        ),
        ("ticketry_work_management::schema::install", "schema"),
        (
            "ticketry_work_management::work_management::commands::CommandError",
            "work_management",
        ),
        (
            "ticketry_work_management::module_links::ModuleLinkStore",
            "module_links",
        ),
        ("ticketry_work_management::entities", "entities"),
        ("ticketry_work_management::test_support", "test_support"),
        (
            "ticketry_workspace_runtime::workspace_operations::WorkspaceOperationIntent",
            "workspace_operations",
        ),
        (
            "ticketry_workspace_runtime::status::WorktreeStatusService",
            "status",
        ),
        (
            "ticketry_workspace_runtime::workspace::operations::WorkspaceOperationIntent",
            "workspace",
        ),
        (
            "ticketry_workspace_runtime::worktree::status::WorktreeStatusService",
            "worktree",
        ),
    ] {
        consumer.reject_import(import, expected_item);
    }
    consumer.reject_import("ticketry_runs::failure_code", "failure_code");
    consumer.reject_import("ticketry_runs::reset_reason", "reset_reason");

    // The final workspace gate also contracts the remaining execution facade
    // and removes authored helpers from the retained generated entity namespaces.
    for (import, item) in [
        ("ticketry_agent_execution::graph::GraphAccess", "graph"),
        ("ticketry_agent_execution::graph_run", "graph_run"),
        (
            "ticketry_agent_execution::launch_delivery",
            "launch_delivery",
        ),
        (
            "ticketry_agent_execution::merge_preparation_launcher",
            "merge_preparation_launcher",
        ),
        ("ticketry_agent_execution::persistence", "persistence"),
        ("ticketry_agent_execution::reconciliation", "reconciliation"),
        ("ticketry_agent_execution::run_now", "run_now"),
        (
            "ticketry_entities::ship_record::AppendReceipt",
            "AppendReceipt",
        ),
        (
            "ticketry_entities::ship_record::ReceiptError",
            "ReceiptError",
        ),
        ("ticketry_entities::ship_record::append", "append"),
        ("ticketry_entities::sprint::PLANNED", "PLANNED"),
        ("ticketry_entities::sprint::ACTIVE", "ACTIVE"),
        ("ticketry_entities::sprint::COMPLETED", "COMPLETED"),
        ("ticketry_entities::sprint_suggestion::WAITING", "WAITING"),
        ("ticketry_entities::sprint_suggestion::ACCEPTED", "ACCEPTED"),
        (
            "ticketry_entities::sprint_suggestion::DISMISSED",
            "DISMISSED",
        ),
    ] {
        consumer.reject_import(import, item);
    }
    for item in FIXTURE_ITEMS {
        consumer.reject_import(&format!("ticketry_work_management::{item}"), item);
    }

    // This is another isolated ordinary dependency graph, not a shipping test
    // binary where dev dependencies can silently unify the fixture feature.
    let with_fixtures = Consumer::build(true);
    with_fixtures.accept_approved_roots(true);
    for item in FIXTURE_ITEMS {
        with_fixtures.accept_import(&format!("ticketry_work_management::{item}"));
    }
    with_fixtures.reject_import("ticketry_work_management::test_support", "test_support");
}
