//! The one transaction a registry change commits through.
//!
//! Discovery observes the filesystem in several ways — a full authorized
//! rescan, a watcher event for one path, a fallback rescan after the event
//! stream broke — but every one of them lands here. The row write and its
//! durable fact are committed together, so a consumer can never see a
//! registered document without its fact, or a fact for a row that was never
//! written.
//!
//! Convergence is the property that makes the fallback safe. A settlement
//! describes what the filesystem holds now; applying it to a registry that
//! already agrees writes no row and publishes no fact. A rescan after a missed
//! event therefore costs one query, and a rescan after nothing happened costs
//! nothing at all.

use sea_orm::sea_query::OnConflict;
use sea_orm::ActiveValue::Set;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};

use ticketry_entities::documents::design_document;

use super::error::DocumentsError;
use super::registry_facts::{self, DocumentChange, DocumentFactRecorder};

/// One document the filesystem holds, ready to be registered.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ObservedDocument {
    pub(super) root_dir: String,
    pub(super) rel_path: String,
    pub(super) content_digest: Option<String>,
}

/// What one pass wants the registry to look like.
///
/// The three lists are already reconciled against the rows that exist, so a
/// settlement is a straight apply rather than a second comparison.
#[derive(Clone, Debug, Default)]
pub(super) struct RegistryPlan {
    /// Documents on disk that no row describes.
    pub(super) registered: Vec<ObservedDocument>,
    /// Rows whose file is still there but now holds different bytes.
    pub(super) changed: Vec<(design_document::Model, String)>,
    /// Rows adopted before digests existed, recording the bytes they already
    /// describe. Filling a missing fingerprint in is not a change anyone made,
    /// so it writes the row and publishes nothing — otherwise the first rescan
    /// after adoption would announce every document as freshly modified.
    pub(super) backfilled: Vec<(design_document::Model, String)>,
    /// Rows whose primary file is gone.
    pub(super) removed: Vec<design_document::Model>,
}

impl RegistryPlan {
    pub(super) fn is_empty(&self) -> bool {
        self.registered.is_empty()
            && self.changed.is_empty()
            && self.backfilled.is_empty()
            && self.removed.is_empty()
    }
}

/// The identity a newly discovered row is registered under. It is derived from
/// the bucket being reconciled, never from the file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RegistrationIdentity {
    pub(crate) module_id: String,
    pub(crate) task_id: String,
    pub(crate) scope: String,
    /// The Agent Run whose watcher observed the file, when one did. Provenance
    /// only: it never widens what may be read.
    pub(crate) discovered_by_run_id: Option<String>,
}

/// Commit one plan and publish a fact for everything it committed.
///
/// An empty plan commits nothing, so a caller may settle unconditionally and a
/// convergent pass stays a no-op.
pub(super) async fn settle(
    database: &DatabaseConnection,
    facts: Option<&DocumentFactRecorder>,
    identity: &RegistrationIdentity,
    plan: RegistryPlan,
) -> Result<(), DocumentsError> {
    if plan.is_empty() {
        return Ok(());
    }
    let now = timestamp();
    let transaction = database.begin().await?;
    let mut published = false;

    for observed in plan.registered {
        let row = design_document::Model {
            id: uuid::Uuid::new_v4().simple().to_string(),
            module_id: identity.module_id.clone(),
            task_id: identity.task_id.clone(),
            scope: identity.scope.clone(),
            root_dir: observed.root_dir,
            rel_path: observed.rel_path,
            discovered_by_run_id: identity.discovered_by_run_id.clone(),
            created_at: now.clone(),
            updated_at: now.clone(),
            content_digest: observed.content_digest,
        };
        // A concurrent registration of the same authorized path wins, and its
        // own settlement published the fact. Discovery never rewrites a row it
        // did not create, and never publishes a create it did not perform.
        let inserted = design_document::Entity::insert(active(&row))
            .on_conflict(
                OnConflict::columns([
                    design_document::Column::RootDir,
                    design_document::Column::RelPath,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec_without_returning(&transaction)
            .await?;
        if inserted == 0 {
            continue;
        }
        published |= publish(facts, &transaction, &row, DocumentChange::Created).await?;
    }

    for (row, digest) in plan.backfilled {
        record_digest(&transaction, &row.id, &digest, &now).await?;
    }

    for (row, digest) in plan.changed {
        record_digest(&transaction, &row.id, &digest, &now).await?;
        let updated = design_document::Model {
            content_digest: Some(digest),
            updated_at: now.clone(),
            ..row
        };
        published |= publish(facts, &transaction, &updated, DocumentChange::Changed).await?;
    }

    if !plan.removed.is_empty() {
        let identities: Vec<String> = plan.removed.iter().map(|row| row.id.clone()).collect();
        design_document::Entity::delete_many()
            .filter(design_document::Column::Id.is_in(identities))
            .exec(&transaction)
            .await?;
        for row in &plan.removed {
            published |= publish(facts, &transaction, row, DocumentChange::Deleted).await?;
        }
    }

    transaction.commit().await?;
    // Only after the commit, so an unavailable subscriber delays delivery
    // rather than rolling back committed truth.
    if published {
        if let Some(facts) = facts {
            facts.wake();
        }
    }
    Ok(())
}

/// Record the bytes a row now describes.
async fn record_digest(
    transaction: &sea_orm::DatabaseTransaction,
    id: &str,
    digest: &str,
    now: &str,
) -> Result<(), DocumentsError> {
    design_document::Entity::update_many()
        .col_expr(
            design_document::Column::ContentDigest,
            sea_orm::sea_query::Expr::value(digest),
        )
        .col_expr(
            design_document::Column::UpdatedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(design_document::Column::Id.eq(id))
        .exec(transaction)
        .await?;
    Ok(())
}

/// Publish one row's fact, or nothing when its owner cannot be resolved.
async fn publish(
    facts: Option<&DocumentFactRecorder>,
    transaction: &sea_orm::DatabaseTransaction,
    row: &design_document::Model,
    change: DocumentChange,
) -> Result<bool, DocumentsError> {
    if facts.is_none() {
        return Ok(false);
    }
    let Some(owner) = registry_facts::resolve_owner(transaction, row).await? else {
        return Ok(false);
    };
    registry_facts::record_document(facts, transaction, &owner, row, change).await?;
    Ok(true)
}

fn active(row: &design_document::Model) -> design_document::ActiveModel {
    design_document::ActiveModel {
        id: Set(row.id.clone()),
        module_id: Set(row.module_id.clone()),
        task_id: Set(row.task_id.clone()),
        scope: Set(row.scope.clone()),
        root_dir: Set(row.root_dir.clone()),
        rel_path: Set(row.rel_path.clone()),
        discovered_by_run_id: Set(row.discovered_by_run_id.clone()),
        created_at: Set(row.created_at.clone()),
        updated_at: Set(row.updated_at.clone()),
        content_digest: Set(row.content_digest.clone()),
    }
}

fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}
