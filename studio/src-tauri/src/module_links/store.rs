//! The one model-shaped write seam for Module Links.
//!
//! Every write goes through here, so the invariants a caller must never be
//! able to submit are applied in one place: identity is derived from the
//! Module, timestamps are server-owned, `created_at` survives a re-link, and
//! the path is accepted only at a shape [`super::local_path`] approves.
//!
//! The store is constructed from a connection the caller already opened. It
//! has no default, no ambient path, and no fallback to the established data
//! directory, so a test, an importer, and the desktop runtime can never
//! accidentally share or mint a second writer.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Set,
};

use super::identity::{compact_module_id, link_id_for_module};
use super::local_path::LocalModulePath;
use super::{entities::module_link, ModuleLinkError};
use crate::entities::work_management::issue;

/// The Work Item type a link may name.
pub(crate) const MODULE_TYPE: &str = "module";

/// One typed link, as callers read it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModuleLinkRecord {
    pub id: String,
    pub module_id: String,
    pub path: String,
}

impl From<module_link::Model> for ModuleLinkRecord {
    fn from(model: module_link::Model) -> Self {
        Self {
            id: model.id,
            module_id: model.module_id,
            path: model.path,
        }
    }
}

/// Reads and restricted writes over the typed Module Link table.
#[derive(Clone)]
pub struct ModuleLinkStore {
    database: DatabaseConnection,
}

impl ModuleLinkStore {
    /// Bind the store to a connection the caller opened.
    #[must_use]
    pub fn new(database: DatabaseConnection) -> Self {
        Self { database }
    }

    /// Every link, in stable Module order.
    ///
    /// # Errors
    ///
    /// Returns [`super::ModuleLinkErrorCode::Storage`] when the read fails.
    pub async fn list(&self) -> Result<Vec<ModuleLinkRecord>, ModuleLinkError> {
        Ok(module_link::Entity::find()
            .order_by_asc(module_link::Column::ModuleId)
            .all(&self.database)
            .await?
            .into_iter()
            .map(ModuleLinkRecord::from)
            .collect())
    }

    /// The link a Module owns, if it has one.
    ///
    /// # Errors
    ///
    /// Returns [`super::ModuleLinkErrorCode::Storage`] when the read fails.
    pub async fn get(&self, module_id: &str) -> Result<Option<ModuleLinkRecord>, ModuleLinkError> {
        Ok(find(&self.database, &compact_module_id(module_id))
            .await?
            .map(ModuleLinkRecord::from))
    }

    /// Record the local folder `module_id` is checked out into.
    ///
    /// The write is an upsert on the Module, because a Module owns at most one
    /// link: re-linking a Module moves its existing row rather than minting a
    /// second one, so `id` and `created_at` are preserved across a change of
    /// folder.
    ///
    /// # Errors
    ///
    /// Returns [`super::ModuleLinkErrorCode::InvalidPath`] when the path shape
    /// is not persistable, [`super::ModuleLinkErrorCode::UnknownModule`] when
    /// the identity is not a Module, and
    /// [`super::ModuleLinkErrorCode::Storage`] when the write fails.
    pub async fn set(
        &self,
        module_id: &str,
        path: &str,
    ) -> Result<ModuleLinkRecord, ModuleLinkError> {
        let path = LocalModulePath::parse(path).map_err(ModuleLinkError::invalid_path)?;
        let module_id = compact_module_id(module_id);
        let module_id = module_id.as_str();
        if !module_exists(&self.database, module_id).await? {
            return Err(ModuleLinkError::unknown_module(module_id));
        }
        let now = crate::work_management::commands::timestamp::now();
        let record = match find(&self.database, module_id).await? {
            Some(existing) => {
                let mut active: module_link::ActiveModel = existing.into();
                active.path = Set(path.into_string());
                active.updated_at = Set(now);
                active.update(&self.database).await?
            }
            None => module_link::ActiveModel {
                id: Set(link_id_for_module(module_id)),
                module_id: Set(module_id.to_owned()),
                path: Set(path.into_string()),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&self.database)
            .await?,
        };
        Ok(record.into())
    }

    /// Forget the folder a Module was checked out into.
    ///
    /// Returns whether a link was removed, so an already-unlinked Module is a
    /// reported outcome rather than an error.
    ///
    /// # Errors
    ///
    /// Returns [`super::ModuleLinkErrorCode::Storage`] when the write fails.
    pub async fn clear(&self, module_id: &str) -> Result<bool, ModuleLinkError> {
        let deleted = module_link::Entity::delete_many()
            .filter(module_link::Column::ModuleId.eq(compact_module_id(module_id)))
            .exec(&self.database)
            .await?;
        Ok(deleted.rows_affected > 0)
    }
}

pub(crate) async fn find(
    database: &impl ConnectionTrait,
    module_id: &str,
) -> Result<Option<module_link::Model>, ModuleLinkError> {
    Ok(module_link::Entity::find()
        .filter(module_link::Column::ModuleId.eq(compact_module_id(module_id)))
        .one(database)
        .await?)
}

pub(crate) async fn module_exists(
    database: &impl ConnectionTrait,
    module_id: &str,
) -> Result<bool, ModuleLinkError> {
    Ok(issue::Entity::find_by_id(compact_module_id(module_id))
        .filter(issue::Column::Type.eq(MODULE_TYPE))
        .one(database)
        .await?
        .is_some())
}
