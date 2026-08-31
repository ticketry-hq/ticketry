//! The one-way Slice 4 Documents and Worktrees handoff.
//!
//! Adoption already happened: the write lease moved inside
//! [`ticketry_workspace_runtime::workspace::handoff::adopt`], before the schema was composed and while
//! the sidecar was still stopped. What remains is proving that the runtime built
//! on top of it can actually serve — and saying so once, in one record, so no
//! surface has to guess.
//!
//! The gate composes eight things: both schema adoptions, the validated
//! one-writer assignment, the durable status outbox, the initial bounded
//! Workspace Operation reconciliation pass, the authorized document roots, the
//! GraphQL surface, the desktop asset protocol, and the watcher supervisor.
//! Composition performs the reconciliation pass and this module reads its
//! result; the rest are probed here. A partial result closes the gate and every
//! document and worktree surface answers a structured unavailable error — after
//! the handoff there is no Django writer left to fall back to.

use std::path::Path;

use tauri_graphql::TransportApi;

use crate::desktop::document_protocol;
use crate::graphql_foundation::ComposedCommandRuntime;
use ticketry_workspace_runtime::workspace::handoff::{
    self, manifest, Slice4Readiness, WorkspaceHandoffError,
};

/// Publish the closed gate. Called at startup, at every backend launch, and at
/// shutdown, so a stale `ready: true` record can never outlive its runtime.
pub(crate) fn close_gate(data_directory: &Path) -> Result<(), WorkspaceHandoffError> {
    handoff::publish_readiness(data_directory, &Slice4Readiness::unavailable())
}

/// Open the gate once the composed runtime proves every part of the capability.
///
/// Every check is a read, so calling this again after a recovery is harmless.
pub(crate) async fn open_gate<R: tauri::Runtime>(
    data_directory: &Path,
    runtime: &ComposedCommandRuntime,
    api: &tauri_graphql::TransportApiImpl,
    application: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let readiness = evaluate(runtime, api, application).await?;
    handoff::publish_readiness(data_directory, &readiness)
        .map_err(|error| format!("could not publish Slice 4 readiness: {error}"))
}

/// Compose the readiness result from what the runtime can actually prove.
///
/// Every gate is evaluated rather than short-circuited, so a refusal names all
/// of the missing parts at once instead of only the first one an operator hits.
async fn evaluate<R: tauri::Runtime>(
    runtime: &ComposedCommandRuntime,
    api: &tauri_graphql::TransportApiImpl,
    application: &tauri::AppHandle<R>,
) -> Result<Slice4Readiness, String> {
    let database = runtime.commands();
    let documents = runtime.documents();
    let mut readiness = Slice4Readiness::unavailable();

    readiness.documents_ownership =
        ticketry_documents::persistence::documents_adopted(database).await;
    readiness.worktree_ownership =
        ticketry_workspace_runtime::worktree::persistence::worktrees_adopted(database).await;
    // The journal has never had a Django writer, so its ownership is simply
    // whether the installed shape is the one this build authored. Without it no
    // filesystem or Git effect has a recovery record at all.
    readiness.operation_journal_ownership =
        ticketry_workspace_runtime::workspace::operations::schema::verify(database)
            .await
            .is_ok();
    readiness.ownership_validated = manifest::validate_schema(database).await.is_ok();
    readiness.status_outbox = documents.publishes_durable_facts();
    readiness.operation_reconciliation = runtime.workspace_reconciled();
    // An authorized root is now resolved from the module's typed link, so what
    // this asks is whether the link schema this build authored is installed.
    readiness.authorized_roots = ticketry_work_management::module_links::schema::verify(database)
        .await
        .is_ok();
    readiness.graphql_workspace = verify_workspace_surface(api).await?;
    // The scheme itself is registered on the shell at build time. What the
    // protocol needs at runtime is the very Documents boundary GraphQL resolves
    // through, so this asks the protocol's own resolver whether it can find it.
    readiness.asset_protocol = document_protocol::resolves_documents(application);
    readiness.document_watch = runtime.document_watch().is_some();

    readiness.ready = true;
    if readiness.validate().is_err() {
        readiness.ready = false;
        return Err(unmet(&readiness));
    }
    Ok(readiness)
}

/// Name every gate that is closed, so one restart tells an operator everything
/// that is missing. It names no absolute path, credential, or command line.
fn unmet(readiness: &Slice4Readiness) -> String {
    let missing = [
        ("Documents schema adoption", readiness.documents_ownership),
        ("Worktree schema adoption", readiness.worktree_ownership),
        (
            "Workspace Operation journal",
            readiness.operation_journal_ownership,
        ),
        (
            "one-writer ownership validation",
            readiness.ownership_validated,
        ),
        ("durable status outbox", readiness.status_outbox),
        (
            "initial workspace-operation reconciliation",
            readiness.operation_reconciliation,
        ),
        ("authorized document roots", readiness.authorized_roots),
        ("document and worktree GraphQL", readiness.graphql_workspace),
        ("desktop document protocol", readiness.asset_protocol),
        ("document watcher supervisor", readiness.document_watch),
    ]
    .into_iter()
    .filter_map(|(name, met)| (!met).then_some(name))
    .collect::<Vec<_>>();
    format!(
        "the workspace runtime is not ready; unmet: {}",
        missing.join(", ")
    )
}

/// The document and worktree fields Studio's production traffic depends on.
/// Every one of them replaced a legacy REST route, so a missing field means the
/// cutover would leave Studio with no writer rather than a slower one.
const REQUIRED_QUERIES: &[&str] = &[
    "directory_completions",
    "worktree_changes",
    "worktree_status",
];
const REQUIRED_MUTATIONS: &[&str] = &[
    "refresh_task_document_registry",
    "refresh_scratch_document_registry",
    "save_design_document",
    "worktree_create",
    "worktree_discard",
];

/// Prove the authoritative document and worktree fields are registered on the
/// installed schema before Studio is told the capability is live.
async fn verify_workspace_surface(api: &tauri_graphql::TransportApiImpl) -> Result<bool, String> {
    let response = api
        .clone()
        .graphql_execute(
            serde_json::json!({
                "query": "query Slice4WorkspaceSurface { __schema { queryType { fields { name } } mutationType { fields { name } } } }"
            })
            .to_string(),
        )
        .await;
    let value: serde_json::Value = serde_json::from_str(&response)
        .map_err(|error| format!("could not decode the Slice 4 workspace probe: {error}"))?;
    if value.get("errors").is_some() {
        return Err("the Slice 4 workspace probe returned errors".to_owned());
    }
    let registered = |pointer: &str, names: &[&str]| {
        let fields = value
            .pointer(pointer)
            .and_then(serde_json::Value::as_array)
            .map(|fields| {
                fields
                    .iter()
                    .filter_map(|field| field.get("name").and_then(serde_json::Value::as_str))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        names.iter().all(|name| fields.contains(name))
    };
    Ok(
        registered("/data/__schema/queryType/fields", REQUIRED_QUERIES)
            && registered("/data/__schema/mutationType/fields", REQUIRED_MUTATIONS),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_probes_the_exact_generated_workspace_field_names() {
        let schema = include_str!("../../../src/graphql-foundation/generated/schema.graphql");
        for field in REQUIRED_QUERIES.iter().chain(REQUIRED_MUTATIONS) {
            assert!(
                schema.contains(&format!("\t{field}(")),
                "the readiness probe names an unregistered GraphQL field: {field}"
            );
        }
    }
}
