//! Lease expiry policy.
//!
//! Periodic reconciliation may only retire leases whose deadline has already
//! passed. Retiring every lease is reserved for the explicit startup and
//! shutdown passes, which run while viewer mutations are gated — a healthy
//! renewed viewer must survive every periodic sweep.

use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};

use ticketry_entities::terminals::viewer_lease;

use super::service::{parse_timestamp, timestamp, ActiveViewer, ViewerOwnershipService};
use super::{ViewerDetachReason, ViewerOwnershipError};

impl ViewerOwnershipService {
    /// Expire every transient lease without deleting durable terminal history.
    /// Startup and normal shutdown use this after mutations have been gated.
    pub async fn expire_all(&self) -> Result<u64, ViewerOwnershipError> {
        let result = viewer_lease::Entity::update_many()
            .col_expr(
                viewer_lease::Column::ExpiresAt,
                sea_orm::sea_query::Expr::value(timestamp(Utc::now())),
            )
            .exec(&self.database)
            .await
            .map_err(ViewerOwnershipError::storage)?;
        let viewers = {
            let mut registry = self
                .viewers
                .lock()
                .expect("viewer ownership registry poisoned");
            registry.prepared.clear();
            std::mem::take(&mut registry.active)
        };
        for viewer in viewers.into_values() {
            viewer.mechanics.detach(ViewerDetachReason::Released);
        }
        Ok(result.rows_affected)
    }

    /// Expire only the leases that have already lapsed, leaving every renewed
    /// lease and its attached mechanics alone. Periodic reconciliation uses
    /// this so ownership is never taken from a healthy viewer.
    pub async fn expire_stale(&self) -> Result<u64, ViewerOwnershipError> {
        let candidates = viewer_lease::Entity::find()
            .all(&self.database)
            .await
            .map_err(ViewerOwnershipError::storage)?;
        let mut expired = 0;
        let mut detached: Vec<ActiveViewer> = Vec::new();
        for candidate in candidates {
            if !has_lapsed(&candidate, Utc::now()) {
                continue;
            }
            let run_lock = self.run_lock(&candidate.agent_run_id);
            let _guard = run_lock.lock().await;
            let now = Utc::now();
            // Re-read under the Agent Run lock: a lease acquired or renewed
            // since the scan owns the viewer and must not be retired here.
            let Some(current) = viewer_lease::Entity::find_by_id(&candidate.agent_run_id)
                .one(&self.database)
                .await
                .map_err(ViewerOwnershipError::storage)?
            else {
                continue;
            };
            if !has_lapsed(&current, now) {
                continue;
            }
            let mut lapsed: viewer_lease::ActiveModel = current.clone().into();
            lapsed.expires_at = Set(timestamp(now));
            lapsed
                .update(&self.database)
                .await
                .map_err(ViewerOwnershipError::storage)?;
            expired += 1;
            detached.extend(self.take_active_owner(&current));
        }
        for viewer in detached {
            viewer.mechanics.detach(ViewerDetachReason::Released);
        }
        Ok(expired)
    }

    /// Take the process-local viewer only when it is the exact owner named by
    /// the expired lease, so a replacement viewer is never detached.
    fn take_active_owner(&self, lease: &viewer_lease::Model) -> Option<ActiveViewer> {
        let mut registry = self
            .viewers
            .lock()
            .expect("viewer ownership registry poisoned");
        registry
            .active
            .get(&lease.agent_run_id)
            .is_some_and(|viewer| {
                viewer.viewer_id == lease.viewer_id && viewer.generation == lease.generation
            })
            .then(|| registry.active.remove(&lease.agent_run_id))
            .flatten()
    }
}

/// An unreadable deadline is treated as lapsed, matching lease renewal.
fn has_lapsed(lease: &viewer_lease::Model, now: chrono::DateTime<Utc>) -> bool {
    parse_timestamp(&lease.expires_at).is_none_or(|expires_at| expires_at <= now)
}
