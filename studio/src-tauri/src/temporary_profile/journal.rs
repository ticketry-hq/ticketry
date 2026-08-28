//! Journal a temporary profile's terminal cleanup before its database dies.
//!
//! Every terminal the profile still records is torn down through its
//! predetermined `temporary_profile` cleanup effect, so a refusal, a deferral,
//! or an unconfirmed kill leaves durable evidence and a retryable effect
//! instead of vanishing with the profile. The journal is then read back: only
//! a journal with no unsettled effect permits the database to be removed.

use std::path::Path;

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait,
    QueryFilter, QueryOrder, Statement,
};

use crate::entities::terminals::{cleanup_effect, session};
use crate::terminal::cleanup::{
    CleanupCause, TerminalCleanupError, TerminalCleanupErrorCode, TerminalCleanupService,
};

/// One cleanup effect the journal did not settle as applied. Its runtime may
/// survive the profile, so its history has to outlive the teardown.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnresolvedCleanup {
    pub agent_run_id: String,
    pub effect_id: String,
    pub state: String,
    pub last_error_code: Option<String>,
}

/// What one journaled teardown pass recorded.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TemporaryProfileTeardown {
    /// Terminals routed through the cleanup journal by this pass.
    pub journaled: usize,
    pub unresolved: Vec<UnresolvedCleanup>,
}

impl TemporaryProfileTeardown {
    /// The journal proved every recorded terminal absent, so nothing durable
    /// is lost by removing the profile.
    pub fn is_complete(&self) -> bool {
        self.unresolved.is_empty()
    }
}

/// The result of tearing a whole profile down, including the cases where the
/// journal itself was never reachable.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProfileTeardownOutcome {
    /// The profile never provisioned terminal storage, so it recorded no
    /// terminal and there is no history to preserve.
    NoTerminalHistory,
    Journaled(TemporaryProfileTeardown),
    /// The journal could not be opened, written, or read back. Nothing is
    /// known about the profile's terminals, so nothing may be destroyed.
    Unavailable(String),
}

impl ProfileTeardownOutcome {
    pub fn is_complete(&self) -> bool {
        match self {
            Self::NoTerminalHistory => true,
            Self::Journaled(teardown) => teardown.is_complete(),
            Self::Unavailable(_) => false,
        }
    }
}

/// Journal a temporary-profile cleanup for every terminal the profile still
/// records, then report what the journal could not settle.
pub async fn journal_terminal_cleanup(
    service: &TerminalCleanupService,
) -> Result<TemporaryProfileTeardown, TerminalCleanupError> {
    let recorded = session::Entity::find()
        .filter(
            Condition::any()
                .add(session::Column::TerminatedAt.is_null())
                .add(session::Column::RuntimeCleanupPending.eq(true)),
        )
        .order_by_asc(session::Column::AgentRunId)
        .all(service.database())
        .await?;
    let mut journaled = 0;
    for terminal in recorded {
        // The cleanup effect identity is derived from the cause and the
        // terminal's runtime identity, so a second teardown pass reuses the
        // same effect rather than manufacturing a new request.
        match service
            .cleanup(
                &terminal.agent_run_id,
                CleanupCause::TemporaryProfile,
                &terminal.tmux_session_name,
            )
            .await
        {
            Ok(_) => journaled += 1,
            // A conflict, a deferral, or an unconfirmed kill is a durable
            // journal entry, not a lost cleanup. It is exactly the history the
            // teardown has to keep, so the pass continues and reports it.
            Err(error) if is_journalled_refusal(error.code()) => journaled += 1,
            Err(error) => return Err(error),
        }
    }
    Ok(TemporaryProfileTeardown {
        journaled,
        unresolved: unresolved(service).await?,
    })
}

/// Open the profile's own database and journal its teardown. This is the
/// blocking seam the process exit path uses, after the desktop runtime and its
/// async executor are already gone.
pub fn journal_profile_teardown(profile: &Path) -> ProfileTeardownOutcome {
    let database_path = profile.join("state.db");
    if !database_path.exists() {
        return ProfileTeardownOutcome::NoTerminalHistory;
    }
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            return ProfileTeardownOutcome::Unavailable(format!(
                "could not start an executor for temporary-profile cleanup: {error}"
            ))
        }
    };
    runtime.block_on(async move {
        let database = match crate::work_management::open_for_commands(&database_path).await {
            Ok(database) => database,
            Err(error) => {
                return ProfileTeardownOutcome::Unavailable(format!(
                    "could not open the temporary profile database: {error}"
                ))
            }
        };
        match terminal_journal_present(&database).await {
            Ok(true) => {}
            Ok(false) => return ProfileTeardownOutcome::NoTerminalHistory,
            Err(error) => {
                return ProfileTeardownOutcome::Unavailable(format!(
                    "could not read the temporary profile cleanup journal: {error}"
                ))
            }
        }
        match journal_terminal_cleanup(&TerminalCleanupService::with_tmux(database)).await {
            Ok(teardown) => ProfileTeardownOutcome::Journaled(teardown),
            Err(error) => ProfileTeardownOutcome::Unavailable(format!(
                "temporary-profile terminal cleanup failed: {error}"
            )),
        }
    })
}

/// Every cleanup effect that is not settled as applied. `applied` is the only
/// state that proves a runtime is gone; a prepared, leased, cleanup-pending,
/// or conflicted effect all describe a runtime that may still exist.
async fn unresolved(
    service: &TerminalCleanupService,
) -> Result<Vec<UnresolvedCleanup>, TerminalCleanupError> {
    Ok(cleanup_effect::Entity::find()
        .filter(cleanup_effect::Column::State.ne("applied"))
        .order_by_asc(cleanup_effect::Column::EffectId)
        .all(service.database())
        .await?
        .into_iter()
        .map(|effect| UnresolvedCleanup {
            agent_run_id: effect.agent_run_id,
            effect_id: effect.effect_id,
            state: effect.state,
            last_error_code: effect.last_error_code,
        })
        .collect())
}

/// A profile that never adopted terminal storage recorded no terminal, so it
/// holds no cleanup history. That is a provable absence, not a read failure.
async fn terminal_journal_present(database: &DatabaseConnection) -> Result<bool, DbErr> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM sqlite_master WHERE type = 'table' \
             AND name IN ('agent_terminal_sessions', 'terminal_cleanup_effects')",
        ))
        .await?;
    Ok(rows.len() == 2)
}

fn is_journalled_refusal(code: TerminalCleanupErrorCode) -> bool {
    matches!(
        code,
        TerminalCleanupErrorCode::Conflict
            | TerminalCleanupErrorCode::EffectBusy
            | TerminalCleanupErrorCode::CleanupPending
            | TerminalCleanupErrorCode::RuntimeIdentityConflict
            | TerminalCleanupErrorCode::RuntimeUnavailable
    )
}
