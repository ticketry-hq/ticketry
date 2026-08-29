//! The single seam every document caller goes through.
//!
//! GraphQL, the desktop document protocol, and — in later tickets — the
//! watcher supervisor and the digest-guarded save all resolve paths and read
//! bytes here, so the authorization boundary exists in exactly one place
//! rather than once per transport.

use std::path::PathBuf;

use sea_orm::{DatabaseConnection, EntityTrait};

use crate::entities::documents::design_document;

use super::asset_access::{self, DocumentAsset};
use super::error::DocumentsError;
use super::registry_facts::DocumentFactRecorder;
use super::registry_refresh::{self, TaskRegistryScope};

/// Handles the composed schema and the desktop shell share. Cloning is cheap:
/// the connection is already a reference-counted handle.
#[derive(Clone)]
pub struct DocumentsService {
    database: DatabaseConnection,
    /// The durable outbox, where it has been adopted. Without it every
    /// invariant still runs and the registry still converges; only the live
    /// publication is missing, and a caller's own response remains authoritative.
    facts: Option<DocumentFactRecorder>,
}

impl DocumentsService {
    pub fn new(database: DatabaseConnection) -> Self {
        Self {
            database,
            facts: None,
        }
    }

    /// Publish this service's registry settlements as durable facts.
    pub fn publishing(mut self, facts: Option<DocumentFactRecorder>) -> Self {
        self.facts = facts;
        self
    }

    pub(crate) fn database(&self) -> &DatabaseConnection {
        &self.database
    }

    pub(crate) fn facts(&self) -> Option<&DocumentFactRecorder> {
        self.facts.as_ref()
    }

    /// Whether registry settlements reach the durable status outbox. Without it
    /// the registry still converges, but no live fact reaches a second window,
    /// so the gate treats it as not ready rather than quietly degraded.
    pub fn publishes_durable_facts(&self) -> bool {
        self.facts.is_some()
    }

    /// Reconcile and return one Work Item's documents.
    pub async fn refresh_task(
        &self,
        scope: TaskRegistryScope,
    ) -> Result<Vec<design_document::Model>, DocumentsError> {
        registry_refresh::refresh_task(&self.database, self.facts.as_ref(), &scope).await
    }

    /// Reconcile and return one module's scratch documents.
    pub async fn refresh_scratch(
        &self,
        module_id: &str,
    ) -> Result<Vec<design_document::Model>, DocumentsError> {
        registry_refresh::refresh_scratch(&self.database, self.facts.as_ref(), module_id).await
    }

    /// Read a registered document or one of its relative assets.
    ///
    /// An unknown document identity and a rejected path are the same absent
    /// result, so a caller cannot tell which of the two it hit.
    pub async fn read_asset(
        &self,
        document_id: &str,
        asset_path: &str,
    ) -> Result<Option<DocumentAsset>, DocumentsError> {
        let Some(root) = self.authorized_root(document_id).await? else {
            return Ok(None);
        };
        let asset_path = asset_path.to_owned();
        Ok(
            tokio::task::spawn_blocking(move || asset_access::read_asset(&root, &asset_path))
                .await
                .unwrap_or(None),
        )
    }

    /// The registered design-directory root of one document, if it exists.
    async fn authorized_root(&self, document_id: &str) -> Result<Option<PathBuf>, DocumentsError> {
        Ok(design_document::Entity::find_by_id(document_id.to_owned())
            .one(&self.database)
            .await?
            .map(|row| PathBuf::from(row.root_dir)))
    }
}
