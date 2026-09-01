use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::{NaiveDateTime, SecondsFormat, TimeZone, Utc};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QuerySelect, TransactionTrait,
};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use ticketry_entities::{
    agent_run, project, {session, viewer_lease},
};

use super::{write_model::persist_prepared, ViewerOwnershipError, ViewerOwnershipErrorCode};

const DEFAULT_LEASE_TTL_SECONDS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewerDetachReason {
    Replaced,
    Released,
    AcquisitionFailed,
}

/// An attached viewer that has passed its transport-specific validation.
///
/// This deliberately exposes only detach. Viewer ownership must never gain a
/// path to tmux termination.
pub trait PreparedViewerMechanics: Send + Sync {
    fn detach(&self, reason: ViewerDetachReason);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateViewerLease {
    pub agent_run_id: String,
    pub viewer_id: String,
    pub transport: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateViewerLease {
    pub agent_run_id: String,
    pub viewer_id: String,
    pub generation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteViewerLease {
    pub agent_run_id: String,
    pub viewer_id: String,
    pub generation: String,
}

#[derive(Clone)]
pub struct ViewerOwnershipService {
    pub(super) database: DatabaseConnection,
    pub(super) ttl: Duration,
    pub(super) run_locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
    pub(super) viewers: Arc<Mutex<ViewerRegistry>>,
}

#[derive(Default)]
pub(super) struct ViewerRegistry {
    pub(super) prepared: HashMap<ViewerIdentity, PreparedViewer>,
    pub(super) active: HashMap<String, ActiveViewer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct ViewerIdentity {
    agent_run_id: String,
    viewer_id: String,
}

pub(super) struct PreparedViewer {
    pub(super) transport: String,
    pub(super) generation: String,
    pub(super) mechanics: Arc<dyn PreparedViewerMechanics>,
}

pub(super) struct ActiveViewer {
    pub(super) viewer_id: String,
    pub(super) generation: String,
    pub(super) mechanics: Arc<dyn PreparedViewerMechanics>,
}

impl ViewerOwnershipService {
    pub fn new(database: DatabaseConnection) -> Self {
        let ttl = env::var("MUXED_VIEWER_LEASE_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_LEASE_TTL_SECONDS)
            .max(1);
        Self::with_ttl(database, Duration::from_secs(ttl))
    }

    pub fn with_ttl(database: DatabaseConnection, ttl: Duration) -> Self {
        Self {
            database,
            ttl: ttl.max(Duration::from_secs(1)),
            run_locks: Arc::default(),
            viewers: Arc::default(),
        }
    }

    /// Stage mechanics that have already attached and passed transport checks.
    /// Re-staging the same identity detaches the abandoned prepared viewer.
    pub fn stage_prepared(
        &self,
        input: &CreateViewerLease,
        mechanics: Arc<dyn PreparedViewerMechanics>,
    ) -> Result<(), ViewerOwnershipError> {
        validate_create(input)?;
        let identity = identity(&input.agent_run_id, &input.viewer_id);
        let displaced = self
            .viewers
            .lock()
            .expect("viewer ownership registry poisoned")
            .prepared
            .insert(
                identity,
                PreparedViewer {
                    transport: input.transport.clone(),
                    generation: Uuid::new_v4().simple().to_string(),
                    mechanics,
                },
            );
        if let Some(displaced) = displaced {
            displaced
                .mechanics
                .detach(ViewerDetachReason::AcquisitionFailed);
        }
        Ok(())
    }

    /// Prepare viewer mechanics before entering the durable ownership path.
    pub async fn create_with<F>(
        &self,
        input: CreateViewerLease,
        prepare: F,
    ) -> Result<viewer_lease::Model, ViewerOwnershipError>
    where
        F: FnOnce() -> Result<Arc<dyn PreparedViewerMechanics>, ViewerOwnershipError>,
    {
        validate_create(&input)?;
        let mechanics = prepare()?;
        self.stage_prepared(&input, mechanics)?;
        self.create(input).await
    }

    /// Create or replace one lease using an exact staged viewer identity.
    pub async fn create(
        &self,
        input: CreateViewerLease,
    ) -> Result<viewer_lease::Model, ViewerOwnershipError> {
        let transaction = self
            .database
            .begin()
            .await
            .map_err(ViewerOwnershipError::storage)?;
        let prepared = self.prepare_create_write(input, &transaction).await?;
        let (model, permit) = persist_prepared(prepared, &transaction).await?;
        transaction
            .commit()
            .await
            .map_err(ViewerOwnershipError::storage)?;
        permit.committed();
        model.ok_or_else(|| {
            ViewerOwnershipError::new(
                ViewerOwnershipErrorCode::Storage,
                "viewer ownership create prepared no model write",
            )
        })
    }

    /// Renew only the current, unexpired viewer identity and generation.
    pub async fn update(
        &self,
        input: UpdateViewerLease,
    ) -> Result<viewer_lease::Model, ViewerOwnershipError> {
        let transaction = self
            .database
            .begin()
            .await
            .map_err(ViewerOwnershipError::storage)?;
        let prepared = self.prepare_update_write(input, &transaction).await?;
        let (model, permit) = persist_prepared(prepared, &transaction).await?;
        transaction
            .commit()
            .await
            .map_err(ViewerOwnershipError::storage)?;
        permit.committed();
        model.ok_or_else(not_owned)
    }

    /// Release only the exact identity and generation. A missing or newer
    /// lease is an idempotent no-op.
    pub async fn delete(
        &self,
        input: DeleteViewerLease,
    ) -> Result<Option<viewer_lease::Model>, ViewerOwnershipError> {
        let transaction = self
            .database
            .begin()
            .await
            .map_err(ViewerOwnershipError::storage)?;
        let prepared = self.prepare_delete_write(input, &transaction).await?;
        let (model, permit) = persist_prepared(prepared, &transaction).await?;
        transaction
            .commit()
            .await
            .map_err(ViewerOwnershipError::storage)?;
        permit.committed();
        Ok(model)
    }

    pub(super) fn run_lock(&self, agent_run_id: &str) -> Arc<AsyncMutex<()>> {
        self.run_locks
            .lock()
            .expect("viewer Agent Run lock registry poisoned")
            .entry(agent_run_id.to_owned())
            .or_default()
            .clone()
    }
}

pub(super) fn validate_create(input: &CreateViewerLease) -> Result<(), ViewerOwnershipError> {
    validate_identity(&input.agent_run_id)?;
    validate_identity(&input.viewer_id)?;
    if !matches!(input.transport.as_str(), "native" | "xterm") {
        return Err(ViewerOwnershipError::new(
            ViewerOwnershipErrorCode::InvalidTransport,
            "viewer transport must be native or xterm",
        ));
    }
    Ok(())
}

pub(super) fn validate_identity_fields(
    agent_run_id: &str,
    viewer_id: &str,
    generation: &str,
) -> Result<(), ViewerOwnershipError> {
    validate_identity(agent_run_id)?;
    validate_identity(viewer_id)?;
    validate_identity(generation)
}

fn validate_identity(value: &str) -> Result<(), ViewerOwnershipError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid.then_some(()).ok_or_else(|| {
        ViewerOwnershipError::new(
            ViewerOwnershipErrorCode::InvalidIdentity,
            "viewer lease identity is invalid",
        )
    })
}

pub(super) fn identity(agent_run_id: &str, viewer_id: &str) -> ViewerIdentity {
    ViewerIdentity {
        agent_run_id: agent_run_id.to_owned(),
        viewer_id: viewer_id.to_owned(),
    }
}

pub(super) fn expires_at(ttl: Duration) -> String {
    timestamp(Utc::now() + chrono::Duration::from_std(ttl).unwrap())
}

pub(super) fn timestamp(value: chrono::DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

pub(super) fn parse_timestamp(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")
                .ok()
                .map(|value| Utc.from_utc_datetime(&value))
        })
}

pub(super) async fn authorize_run(
    transaction: &sea_orm::DatabaseTransaction,
    agent_run_id: &str,
) -> Result<(), ViewerOwnershipError> {
    let run_exists = agent_run::Entity::find_by_id(agent_run_id)
        .one(transaction)
        .await
        .map_err(ViewerOwnershipError::storage)?
        .is_some();
    let namespace = crate::tmux_adapter::current_runtime_namespace().map_err(|error| {
        ViewerOwnershipError::new(
            ViewerOwnershipErrorCode::AgentRunNotFound,
            format!("the viewer lease runtime scope is unavailable: {error}"),
        )
    })?;
    let terminal = session::Entity::find_by_id(agent_run_id)
        .one(transaction)
        .await
        .map_err(ViewerOwnershipError::storage)?;
    let session_is_local = terminal
        .as_ref()
        .is_some_and(|session| session.runtime_namespace.as_deref() == Some(namespace.as_str()));
    let project_is_authorized = if let Some(terminal) = terminal {
        project::Entity::find()
            .select_only()
            .column(project::Column::Id)
            .filter(project::Column::Id.eq(terminal.project_id))
            .into_tuple::<String>()
            .one(transaction)
            .await
            .map_err(ViewerOwnershipError::storage)?
            .is_some()
    } else {
        false
    };
    if run_exists && session_is_local && project_is_authorized {
        return Ok(());
    }
    Err(ViewerOwnershipError::new(
        ViewerOwnershipErrorCode::AgentRunNotFound,
        "the viewer lease Agent Run is not authorized in this terminal runtime",
    ))
}

pub(super) fn not_owned() -> ViewerOwnershipError {
    ViewerOwnershipError::new(
        ViewerOwnershipErrorCode::LeaseNotOwned,
        "the viewer lease was replaced, expired, or released",
    )
}
