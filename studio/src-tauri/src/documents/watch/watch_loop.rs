//! One run's watcher: drain, fold, settle, and fall back.
//!
//! The loop holds one invariant above all others — **the event stream is never
//! treated as complete**. Every path it can validate is settled promptly, and
//! every signal that the stream lost something (an overflow, a watch failure,
//! or simply starting up after events happened while nothing was watching) is
//! answered with a full authorized rescan of the same root. Discovery is
//! convergent, so the fallback is cheap when nothing was missed and correct
//! when something was.
//!
//! Nothing here decides what a document is, what a change means, or who owns a
//! bucket. Those live in Documents, and the watcher only says "look at this
//! root, at these paths, now".

use std::path::PathBuf;
use std::time::{Duration, Instant};

use sea_orm::DatabaseConnection;
use tokio_util::sync::CancellationToken;

use crate::documents::{registry_refresh, DocumentFactRecorder, RegistrationIdentity};

use super::debounce::{PendingPaths, DEBOUNCE};
use super::filesystem_events::{DirectoryWatch, FilesystemEvent};
use super::observed_paths::document_rel_path;

/// Everything one watcher needs. It is assembled by the supervisor from
/// authoritative rows, never from a caller.
pub(super) struct WatchContext {
    pub(super) database: DatabaseConnection,
    pub(super) facts: Option<DocumentFactRecorder>,
    pub(super) identity: RegistrationIdentity,
    pub(super) root: PathBuf,
    pub(super) window: Duration,
}

/// Drain one watch until it is cancelled or its stream ends.
///
/// The first thing it does is rescan: a watcher starting up has no claim on
/// what happened before it existed, which is what makes a restart, a late
/// start, and a resumed run all converge without a special case.
pub(super) async fn run(
    context: WatchContext,
    mut watch: Box<dyn DirectoryWatch>,
    cancel: CancellationToken,
) {
    let root = context.root.to_string_lossy().into_owned();
    rescan(&context, &root).await;

    let mut pending = PendingPaths::new(context.window);
    loop {
        let wait = pending.due_in(Instant::now());
        let event = tokio::select! {
            biased;
            () = cancel.cancelled() => break,
            // A closed window settles what is folded; an open one waits for it.
            () = sleep_until_due(wait), if wait.is_some() => {
                settle(&context, &root, pending.take()).await;
                continue;
            }
            event = watch.events().recv() => event,
        };
        let Some(event) = event else {
            // The stream ended without a failure event. Whatever it stopped
            // describing is still on disk, so the root is re-read once before
            // the watcher gives up.
            settle(&context, &root, pending.take()).await;
            rescan(&context, &root).await;
            break;
        };
        match event {
            FilesystemEvent::Touched(path) | FilesystemEvent::Vanished(path) => {
                // Appearance and removal are folded identically: the settlement
                // re-reads the path, so what the event *claimed* happened never
                // becomes what gets recorded.
                if let Some(rel_path) = document_rel_path(&context.root, &path) {
                    pending.observe(rel_path, Instant::now());
                }
            }
            FilesystemEvent::Overflowed | FilesystemEvent::Failed => {
                // Notifications were lost. Anything folded is still true, so it
                // is settled first, and then the whole root is re-read.
                settle(&context, &root, pending.take()).await;
                rescan(&context, &root).await;
            }
        }
    }
    // Whatever was folded when the watcher stopped is still a real observation.
    settle(&context, &root, pending.take()).await;
}

async fn sleep_until_due(wait: Option<Duration>) {
    tokio::time::sleep(wait.unwrap_or(DEBOUNCE)).await;
}

async fn settle(context: &WatchContext, root: &str, paths: std::collections::BTreeSet<String>) {
    if paths.is_empty() {
        return;
    }
    if let Err(error) = registry_refresh::settle_paths(
        &context.database,
        context.facts.as_ref(),
        &context.identity,
        root,
        &paths,
    )
    .await
    {
        // A settlement that could not commit is exactly the case a rescan
        // exists for, so it is reported and then re-derived rather than lost.
        eprintln!("Ticketry could not settle observed documents: {error}");
        rescan(context, root).await;
    }
}

async fn rescan(context: &WatchContext, root: &str) {
    if let Err(error) = registry_refresh::rescan_root(
        &context.database,
        context.facts.as_ref(),
        &context.identity,
        root,
    )
    .await
    {
        eprintln!("Ticketry could not rescan an authorized design directory: {error}");
    }
}
