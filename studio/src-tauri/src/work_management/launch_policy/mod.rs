mod auto_start;
mod catalog;
mod compatibility;
mod context;
mod decisions;
mod delivery;
mod rejections;
mod resolver;
mod retry;
mod rows;
mod skills;
mod types;

#[cfg(test)]
mod rejection_tests;

pub use auto_start::prepare_pending_auto_starts;
pub use compatibility::submit_interactive;
pub use decisions::{load_by_identity, mark_delivered, pending, record};
pub(crate) use delivery::execute as execute_pending_decision;
pub use rejections::{
    for_work_item as rejections_for_work_item, is_recoverable, LaunchPolicyRejection,
    RECOVERABLE_CODES,
};
pub use resolver::LaunchPolicyResolver;
pub use retry::prepare_pending_retries;
pub use types::{
    CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest, ModuleLinkInput,
    SelectedProfileInput,
};

/// Create both halves of the durable launch ledger: the decisions the resolver
/// committed and the rejections explaining the occurrences it could not.
pub(crate) async fn ensure_schema(
    database: &impl sea_orm::ConnectionTrait,
) -> Result<(), sea_orm::DbErr> {
    decisions::ensure_schema(database).await?;
    rejections::ensure_schema(database).await
}
