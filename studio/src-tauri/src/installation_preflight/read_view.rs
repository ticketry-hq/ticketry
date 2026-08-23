//! One consistent read view over the installation, held open for every check.
//!
//! Preflight's answer has to describe a single committed state. Running each
//! check on its own connection would let a writer commit between two checks and
//! produce a report that no version of the installation ever matched — the
//! worst possible input to a decision about mutating it. So every check runs
//! inside one read transaction on one read-only connection.
//!
//! The view is read-only three times over: SQLite's read-only open flag,
//! `query_only` on the connection, and a transaction that is only ever rolled
//! back. Neither the database nor its write-ahead log can be rewritten through
//! it, so a refusal leaves the source byte-for-byte restorable.

use std::path::Path;

use sea_orm::{
    ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbBackend, Statement,
    TransactionTrait,
};

use crate::installation_classification::engine;

use super::error::{PreflightError, PreflightFailure};

/// A read-only connection with a read transaction open on it.
pub struct ReadView {
    connection: DatabaseConnection,
    transaction: DatabaseTransaction,
}

impl ReadView {
    /// Open `data_directory`'s state database as one consistent read view.
    ///
    /// # Errors
    ///
    /// Returns [`PreflightFailure::UnreadableInstallation`] when the database
    /// cannot be opened read-only or the read transaction cannot start.
    pub async fn open(data_directory: &Path) -> Result<Self, PreflightError> {
        let database = data_directory.join(engine::STATE_DATABASE);
        let connection = engine::open_read_only(&database).await.map_err(|error| {
            unreadable(format!(
                "could not open the installation read-only: {}",
                error.detail()
            ))
        })?;
        // `query_only` is belt to the read-only flag's braces: it makes any
        // statement that would write fail at the connection rather than relying
        // on the open mode alone. The pool holds exactly one connection, so the
        // setting and the transaction below apply to the same one.
        connection
            .execute_raw(Statement::from_string(
                DbBackend::Sqlite,
                "PRAGMA query_only = 1".to_owned(),
            ))
            .await
            .map_err(|error| unreadable(format!("could not make the view read-only: {error}")))?;
        let transaction = connection.begin().await.map_err(|error| {
            unreadable(format!("could not open a consistent read view: {error}"))
        })?;
        Ok(Self {
            connection,
            transaction,
        })
    }

    /// The transaction every check reads through.
    #[must_use]
    pub const fn reader(&self) -> &DatabaseTransaction {
        &self.transaction
    }

    /// Close the view, rolling the read transaction back.
    ///
    /// Closing is best-effort by design: a read transaction has nothing to
    /// flush, and a close failure must not turn a completed preflight into a
    /// refusal the user cannot act on.
    pub async fn close(self) {
        let _ = self.transaction.rollback().await;
        let _ = self.connection.close().await;
    }
}

fn unreadable(detail: String) -> PreflightError {
    PreflightError::new(PreflightFailure::UnreadableInstallation, detail)
}
