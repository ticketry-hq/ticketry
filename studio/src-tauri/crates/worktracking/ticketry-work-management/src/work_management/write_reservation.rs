//! Take SQLite's write lock before a restricted model view reads.
//!
//! seaolim 29f2417 opens every restricted view transaction with a deferred
//! `BEGIN`. On the WAL command pool a deferred transaction that reads first
//! and writes later cannot upgrade to a writer while another connection holds
//! the write lock (SQLITE_BUSY, 5) or after one committed past its snapshot
//! (SQLITE_BUSY_SNAPSHOT, 517). SQLite skips the busy handler for that
//! upgrade, so the user's write failed at once with "database is locked"
//! (CODING-2911). A write statement that touches no row, issued before the
//! view's first read, starts the write transaction while the busy handler
//! still applies, so the view queues behind the other writer instead. It
//! rewrites a non-key Project column so SQLite compiles no foreign-key or
//! cascade work for it. A request without write ownership reserves nothing,
//! so the view's own guard still refuses it with its domain error.
//!
//! Every WorkTracker restricted view passes its hook to seaolim wrapped in
//! [`ReservedWrite`] until seaolim begins its transactions with
//! `BEGIN IMMEDIATE`. Authored commands own their transactions and open them
//! with [`super::database::begin_write`]. The tests below hold both rules for
//! every file in the crate.

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter,
};
use seaography::async_graphql::{dynamic::ResolverContext, Result};
use seaolim::{
    PreparedModelSet, PreparedModelWrite, RestrictedModelMutation, RestrictedModelSetMutation,
};
use ticketry_entities::project;

use super::commands::CommandDatabase;

/// A restricted view hook whose transaction holds the writer from before the
/// hook's first read.
pub(crate) struct ReservedWrite<H>(pub(crate) H);

#[sea_orm::prelude::async_trait::async_trait]
impl<T, A, H> RestrictedModelMutation<T, A> for ReservedWrite<H>
where
    T: EntityTrait,
    A: ActiveModelTrait<Entity = T>,
    H: RestrictedModelMutation<T, A>,
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<A, T::Model>> {
        reserve(ctx, transaction).await?;
        self.0.prepare(ctx, transaction).await
    }
}

#[sea_orm::prelude::async_trait::async_trait]
impl<T, A, H> RestrictedModelSetMutation<T, A> for ReservedWrite<H>
where
    T: EntityTrait,
    A: ActiveModelTrait<Entity = T>,
    H: RestrictedModelSetMutation<T, A>,
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelSet<A, T::Model>> {
        reserve(ctx, transaction).await?;
        self.0.prepare(ctx, transaction).await
    }
}

/// The non-null primary-key predicate matches no row.
async fn reserve(ctx: &ResolverContext<'_>, transaction: &DatabaseTransaction) -> Result<()> {
    if ctx.data_opt::<CommandDatabase>().is_none() {
        return Ok(());
    }
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.is_null())
        .exec(transaction)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    const SOURCE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    const SEAOLIM_REGISTRARS: [&str; 2] = [
        "register_restricted_model_mutation",
        "register_restricted_model_set_mutation",
    ];

    fn source_files(directory: &Path, files: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(directory).expect("read a source directory") {
            let path = entry.expect("read a source entry").path();
            if path.is_dir() {
                source_files(&path, files);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                files.push(path);
            }
        }
    }

    /// Calls of a seaolim restricted registrar in one source file.
    fn registrar_calls(body: &str) -> usize {
        SEAOLIM_REGISTRARS
            .iter()
            .map(|registrar| {
                body.matches(&format!("{registrar}::<")).count()
                    + body.matches(&format!("{registrar}(")).count()
            })
            .sum()
    }

    #[test]
    fn every_restricted_view_reserves_the_writer_before_reading() {
        let mut files = Vec::new();
        source_files(Path::new(SOURCE), &mut files);
        let bypasses = files
            .into_iter()
            .filter(|path| {
                let body = std::fs::read_to_string(path).expect("read a source file");
                body.matches("ReservedWrite(").count() < registrar_calls(&body)
            })
            .collect::<Vec<_>>();
        assert!(
            bypasses.is_empty(),
            "wrap every restricted view hook in write_reservation::ReservedWrite so a \
             read-first view cannot fail with SQLite 5/517: {bypasses:#?}"
        );
    }

    #[test]
    fn every_authored_command_begins_its_transaction_as_the_writer() {
        let mut files = Vec::new();
        source_files(
            &Path::new(SOURCE).join("work_management/commands"),
            &mut files,
        );
        let deferred = files
            .into_iter()
            .filter(|path| {
                !path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().contains("test"))
            })
            .filter(|path| {
                std::fs::read_to_string(path)
                    .expect("read a source file")
                    .contains(".begin().await")
            })
            .collect::<Vec<_>>();
        assert!(
            deferred.is_empty(),
            "open command transactions with database::begin_write so a read-first \
             command cannot fail with SQLite 5/517: {deferred:#?}"
        );
    }
}
