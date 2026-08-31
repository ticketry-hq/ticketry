//! Prepared Viewer Lease writes shared by direct callers and Seaolim views.

use std::sync::{Arc, Mutex};

use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseTransaction, EntityTrait};
use tokio::sync::OwnedMutexGuard;

use ticketry_entities::terminals::viewer_lease;

use super::service::{
    authorize_run, expires_at, identity, not_owned, parse_timestamp, timestamp, ActiveViewer,
    ViewerOwnershipService, ViewerRegistry,
};
use super::{
    CreateViewerLease, DeleteViewerLease, PreparedViewerMechanics, UpdateViewerLease,
    ViewerDetachReason, ViewerOwnershipError, ViewerOwnershipErrorCode,
};

pub enum ViewerLeaseModelWrite {
    Insert(viewer_lease::ActiveModel),
    Update(viewer_lease::ActiveModel),
    Delete {
        model: viewer_lease::Model,
        active_model: viewer_lease::ActiveModel,
    },
    Noop,
}

pub struct PreparedViewerLeaseWrite {
    pub write: ViewerLeaseModelWrite,
    pub permit: ViewerLeaseWritePermit,
}

pub struct ViewerLeaseWritePermit {
    _guard: OwnedMutexGuard<()>,
    after_commit: Option<AfterCommit>,
}

enum AfterCommit {
    Create {
        viewers: Arc<Mutex<ViewerRegistry>>,
        agent_run_id: String,
        viewer_id: String,
        generation: String,
        mechanics: Arc<dyn PreparedViewerMechanics>,
    },
    Delete {
        viewers: Arc<Mutex<ViewerRegistry>>,
        agent_run_id: String,
        viewer_id: String,
        generation: String,
    },
}

impl ViewerOwnershipService {
    pub async fn prepare_create_write(
        &self,
        input: CreateViewerLease,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedViewerLeaseWrite, ViewerOwnershipError> {
        super::service::validate_create(&input)?;
        let identity = identity(&input.agent_run_id, &input.viewer_id);
        let prepared = self
            .viewers
            .lock()
            .expect("viewer ownership registry poisoned")
            .prepared
            .remove(&identity)
            .ok_or_else(|| {
                ViewerOwnershipError::new(
                    ViewerOwnershipErrorCode::MechanicsNotPrepared,
                    "viewer mechanics must attach and validate before ownership is created",
                )
            })?;
        if prepared.transport != input.transport {
            prepared
                .mechanics
                .detach(ViewerDetachReason::AcquisitionFailed);
            return Err(ViewerOwnershipError::new(
                ViewerOwnershipErrorCode::MechanicsNotPrepared,
                "the prepared viewer transport does not match the ownership request",
            ));
        }

        let guard = self.run_lock(&input.agent_run_id).lock_owned().await;
        let permit = ViewerLeaseWritePermit::create(
            guard,
            self.viewers.clone(),
            &input,
            prepared.generation.clone(),
            prepared.mechanics,
        );
        authorize_run(transaction, &input.agent_run_id).await?;
        let now = Utc::now();
        let existing = viewer_lease::Entity::find_by_id(&input.agent_run_id)
            .one(transaction)
            .await
            .map_err(ViewerOwnershipError::storage)?;
        let active = viewer_lease::ActiveModel {
            agent_run_id: Set(input.agent_run_id.clone()),
            viewer_id: Set(input.viewer_id.clone()),
            transport: Set(input.transport.clone()),
            generation: Set(prepared.generation),
            acquired_at: Set(timestamp(now)),
            expires_at: Set(timestamp(
                now + chrono::Duration::from_std(self.ttl).unwrap(),
            )),
        };
        let write = match existing {
            Some(_) => ViewerLeaseModelWrite::Update(active),
            None => ViewerLeaseModelWrite::Insert(active),
        };
        Ok(PreparedViewerLeaseWrite { write, permit })
    }

    pub async fn prepare_update_write(
        &self,
        input: UpdateViewerLease,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedViewerLeaseWrite, ViewerOwnershipError> {
        super::service::validate_identity_fields(
            &input.agent_run_id,
            &input.viewer_id,
            &input.generation,
        )?;
        let guard = self.run_lock(&input.agent_run_id).lock_owned().await;
        let permit = ViewerLeaseWritePermit::plain(guard);
        authorize_run(transaction, &input.agent_run_id).await?;
        let now = Utc::now();
        let Some(model) = viewer_lease::Entity::find_by_id(&input.agent_run_id)
            .one(transaction)
            .await
            .map_err(ViewerOwnershipError::storage)?
        else {
            return Err(not_owned());
        };
        if model.viewer_id != input.viewer_id
            || model.generation != input.generation
            || parse_timestamp(&model.expires_at).is_none_or(|expires_at| expires_at <= now)
        {
            return Err(not_owned());
        }
        let mut active: viewer_lease::ActiveModel = model.into();
        active.expires_at = Set(expires_at(self.ttl));
        Ok(PreparedViewerLeaseWrite {
            write: ViewerLeaseModelWrite::Update(active),
            permit,
        })
    }

    pub async fn prepare_delete_write(
        &self,
        input: DeleteViewerLease,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedViewerLeaseWrite, ViewerOwnershipError> {
        super::service::validate_identity_fields(
            &input.agent_run_id,
            &input.viewer_id,
            &input.generation,
        )?;
        let guard = self.run_lock(&input.agent_run_id).lock_owned().await;
        authorize_run(transaction, &input.agent_run_id).await?;
        let model = viewer_lease::Entity::find_by_id(&input.agent_run_id)
            .one(transaction)
            .await
            .map_err(ViewerOwnershipError::storage)?;
        let Some(model) = model.filter(|model| {
            model.viewer_id == input.viewer_id && model.generation == input.generation
        }) else {
            return Ok(PreparedViewerLeaseWrite {
                write: ViewerLeaseModelWrite::Noop,
                permit: ViewerLeaseWritePermit::plain(guard),
            });
        };
        let permit = ViewerLeaseWritePermit::delete(
            guard,
            self.viewers.clone(),
            &input.agent_run_id,
            &input.viewer_id,
            &input.generation,
        );
        Ok(PreparedViewerLeaseWrite {
            write: ViewerLeaseModelWrite::Delete {
                active_model: model.clone().into(),
                model,
            },
            permit,
        })
    }
}

impl ViewerLeaseWritePermit {
    fn plain(guard: OwnedMutexGuard<()>) -> Self {
        Self {
            _guard: guard,
            after_commit: None,
        }
    }

    fn create(
        guard: OwnedMutexGuard<()>,
        viewers: Arc<Mutex<ViewerRegistry>>,
        input: &CreateViewerLease,
        generation: String,
        mechanics: Arc<dyn PreparedViewerMechanics>,
    ) -> Self {
        Self {
            _guard: guard,
            after_commit: Some(AfterCommit::Create {
                viewers,
                agent_run_id: input.agent_run_id.clone(),
                viewer_id: input.viewer_id.clone(),
                generation,
                mechanics,
            }),
        }
    }

    fn delete(
        guard: OwnedMutexGuard<()>,
        viewers: Arc<Mutex<ViewerRegistry>>,
        agent_run_id: &str,
        viewer_id: &str,
        generation: &str,
    ) -> Self {
        Self {
            _guard: guard,
            after_commit: Some(AfterCommit::Delete {
                viewers,
                agent_run_id: agent_run_id.to_owned(),
                viewer_id: viewer_id.to_owned(),
                generation: generation.to_owned(),
            }),
        }
    }

    pub fn committed(mut self) {
        let Some(after_commit) = self.after_commit.take() else {
            return;
        };
        match after_commit {
            AfterCommit::Create {
                viewers,
                agent_run_id,
                viewer_id,
                generation,
                mechanics,
            } => {
                let displaced = viewers
                    .lock()
                    .expect("viewer ownership registry poisoned")
                    .active
                    .insert(
                        agent_run_id,
                        ActiveViewer {
                            viewer_id,
                            generation,
                            mechanics,
                        },
                    );
                if let Some(displaced) = displaced {
                    displaced.mechanics.detach(ViewerDetachReason::Replaced);
                }
            }
            AfterCommit::Delete {
                viewers,
                agent_run_id,
                viewer_id,
                generation,
            } => {
                let released = {
                    let mut registry = viewers.lock().expect("viewer ownership registry poisoned");
                    let exact = registry.active.get(&agent_run_id).is_some_and(|viewer| {
                        viewer.viewer_id == viewer_id && viewer.generation == generation
                    });
                    exact
                        .then(|| registry.active.remove(&agent_run_id))
                        .flatten()
                };
                if let Some(released) = released {
                    released.mechanics.detach(ViewerDetachReason::Released);
                }
            }
        }
    }
}

impl Drop for ViewerLeaseWritePermit {
    fn drop(&mut self) {
        if let Some(AfterCommit::Create { mechanics, .. }) = self.after_commit.take() {
            mechanics.detach(ViewerDetachReason::AcquisitionFailed);
        }
    }
}

pub(super) async fn persist_prepared(
    prepared: PreparedViewerLeaseWrite,
    transaction: &DatabaseTransaction,
) -> Result<(Option<viewer_lease::Model>, ViewerLeaseWritePermit), ViewerOwnershipError> {
    let PreparedViewerLeaseWrite { write, permit } = prepared;
    let model = match write {
        ViewerLeaseModelWrite::Insert(active) => Some(
            active
                .insert(transaction)
                .await
                .map_err(ViewerOwnershipError::storage)?,
        ),
        ViewerLeaseModelWrite::Update(active) => Some(
            active
                .update(transaction)
                .await
                .map_err(ViewerOwnershipError::storage)?,
        ),
        ViewerLeaseModelWrite::Delete {
            model,
            active_model,
        } => {
            active_model
                .delete(transaction)
                .await
                .map_err(ViewerOwnershipError::storage)?;
            Some(model)
        }
        ViewerLeaseModelWrite::Noop => None,
    };
    Ok((model, permit))
}
