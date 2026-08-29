#![allow(non_snake_case)]

//! The public contract over Module Links: generated reads, one restricted write.
//!
//! Reads are Seaography's generated model graph, unfiltered — a link carries no
//! secret, and the client that renders a Module's folder wants exactly the row.
//!
//! Writes are one authored operation because the generated update and delete
//! cannot express the two things this Model requires:
//!
//! | Operation | Public fields | Identity/scope | Invariants | Decision |
//! | --- | --- | --- | --- | --- |
//! | Create one | `id`, `module_id`, `path`, timestamps | no bound owner | identity is derived, not submitted; timestamps are server-owned | private |
//! | Create batch | none | no owned caller | no batch contract is required | private |
//! | Update | every column | generated filter is optional and may rewrite many rows | one non-null Module must be bound | private |
//! | Delete | none | generated filter is optional and may delete many rows | one non-null Module must be bound | private |
//! | `set_module_link` | `path` only | one Module, bound non-null | derived identity, preserved `created_at`, shape check, usable-folder check | authored |
//! | `clear_module_link` | none | one Module, bound non-null | reports whether a link was there | authored |
//!
//! Both writes bind the Module as a non-null argument, so no caller can widen a
//! write past the one Module it named, and the input object carries the local
//! path and nothing else — never the identity, the owning Module, or a
//! timestamp. Both delegate to [`super::ModuleLinkStore`], which stays the one
//! write seam.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields, CustomInputType,
};

use super::resolution;
use super::{entities::module_link, ModuleLinkError, ModuleLinkStore};
use crate::work_management::commands::CommandDatabase;

/// The one caller-writable fact about a Module Link.
///
/// Deliberately a one-field object rather than the generated update input: the
/// row's identity, its owning Module, and its timestamps are server-owned, and
/// an allowlist that is a separate type cannot silently regain a column when
/// the table gains one.
#[derive(Clone, Debug, CustomInputType)]
#[seaography(input_type_name = "ModuleLinkPathInput")]
pub struct ModuleLinkPathInput {
    /// The absolute local folder this installation checks the Module out into.
    pub path: String,
}

pub struct ModuleLinkMutations;

#[CustomFields]
impl ModuleLinkMutations {
    /// Record the local folder a Module is checked out into.
    ///
    /// The write is an upsert on the bound Module, because a Module owns at
    /// most one link: re-linking moves the existing row rather than minting a
    /// second one. The folder is proven usable before anything is persisted,
    /// so a link a launch could not run in never reaches a row.
    async fn set_module_link(
        ctx: &Context<'_>,
        module_id: String,
        link: ModuleLinkPathInput,
    ) -> Result<module_link::Model> {
        let database = write_database(ctx)?;
        // Validation runs before persistence, not only before launch: a folder
        // the user cannot launch in is a mistake to report while they are still
        // looking at the picker.
        crate::launch_paths::validate_module_folder(Some(link.path.trim()))
            .map_err(|failure| refusal(resolution::ModuleFolderRefusal::from(failure)))?;
        let store = ModuleLinkStore::new(database.clone());
        store
            .set(&module_id, &link.path)
            .await
            .map_err(store_error)?;
        authoritative_link(database, &module_id).await
    }

    /// Forget the folder a Module was checked out into.
    ///
    /// An already-unlinked Module reports `false` rather than failing, because
    /// "there is no link" is the state the caller asked for either way.
    async fn clear_module_link(ctx: &Context<'_>, module_id: String) -> Result<bool> {
        ModuleLinkStore::new(write_database(ctx)?.clone())
            .clear(&module_id)
            .await
            .map_err(store_error)
    }
}

/// Register the generated read graph and the two authored writes.
pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    seaography::register_entity!(builder, module_link, mutation: false);
    builder.register_custom_input::<ModuleLinkPathInput>();
    builder.register_custom_mutation::<ModuleLinkMutations>();
    builder
}

/// The row as it now stands, read back through the generated entity.
async fn authoritative_link(
    database: &sea_orm::DatabaseConnection,
    module_id: &str,
) -> Result<module_link::Model> {
    super::store::find(database, module_id)
        .await
        .map_err(store_error)?
        .ok_or_else(|| {
            Error::new("The Module Link was written but could not be read back.")
                .extend_with(|_, extension| extension.set("code", "module_link_storage_failed"))
        })
}

fn write_database<'a>(ctx: &'a Context<'a>) -> Result<&'a sea_orm::DatabaseConnection> {
    ctx.data::<CommandDatabase>()
        .map(|database| &database.0)
        .map_err(|_| {
            Error::new("Module Links cannot be written before write ownership transfers.")
                .extend_with(|_, extension| {
                    extension.set("code", "module_link_write_unavailable");
                })
        })
}

fn store_error(error: ModuleLinkError) -> Error {
    let code = error.code().as_str();
    let detail = error.to_string();
    Error::new(detail.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", detail))
}

fn refusal(refusal: resolution::ModuleFolderRefusal) -> Error {
    let code = refusal.code();
    Error::new(refusal.message())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", refusal.message()))
}
