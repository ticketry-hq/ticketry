//! One watcher per active run, and no more.
//!
//! The supervisor keeps a live set of watchers equal to the set of eligible
//! Agent Runs, and it recomputes that equality from the database rather than
//! reacting to events. Reconciling instead of reacting is what gives four
//! behaviours one implementation:
//!
//! * a launched run gains a watcher,
//! * a completed, terminated, or lost run loses one,
//! * a restart reconstructs exactly the watchers that are still eligible, and
//! * a duplicate request is a no-op, because the map is keyed by run.
//!
//! Shutdown cancels every watcher, so a finished application leaves no
//! background task behind.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio_util::sync::CancellationToken;

use crate::{DocumentFactRecorder, DocumentsError, DocumentsService};

use super::debounce::DEBOUNCE;
use super::eligibility::{self, WatchTarget};
use super::filesystem_events::{FilesystemWatcher, NotifyWatcher};
use super::watch_loop::{self, WatchContext};

/// How often the live set is re-derived. A watcher is a background task, not a
/// user-visible latency: a launch is picked up within one interval, and every
/// pass is a single indexed read that writes nothing when nothing changed.
const SUPERVISION_INTERVAL: Duration = Duration::from_secs(2);

struct Watcher {
    cancel: CancellationToken,
    /// The root the watcher was started for. A run whose design directory
    /// changed is restarted rather than left watching the old one.
    design_dir: String,
}

/// The live watcher set for one composed runtime.
#[derive(Clone)]
pub struct DocumentWatchSupervisor {
    database: DatabaseConnection,
    facts: Option<DocumentFactRecorder>,
    watcher: Arc<dyn FilesystemWatcher>,
    window: Duration,
    live: Arc<Mutex<HashMap<String, Watcher>>>,
    /// Cancelled once, at shutdown. Every watcher is a child of it, so no
    /// watcher can outlive the application that composed it.
    shutdown: CancellationToken,
}

impl DocumentWatchSupervisor {
    /// The shipping supervisor, over the platform notification API.
    pub fn new(documents: &DocumentsService) -> Self {
        Self::with_watcher(documents, Arc::new(NotifyWatcher), DEBOUNCE)
    }

    /// A supervisor over a supplied event source. Tests drive overflow, watch
    /// failure, and burst behaviour through this seam; production uses
    /// [`DocumentWatchSupervisor::new`].
    pub fn with_watcher(
        documents: &DocumentsService,
        watcher: Arc<dyn FilesystemWatcher>,
        window: Duration,
    ) -> Self {
        Self {
            database: documents.database().clone(),
            facts: documents.facts().cloned(),
            watcher,
            window,
            live: Arc::new(Mutex::new(HashMap::new())),
            shutdown: CancellationToken::new(),
        }
    }

    /// Make the live watcher set equal the eligible set.
    ///
    /// Idempotent and safe to repeat: a run that already has a watcher for the
    /// same root keeps the one it has.
    pub async fn reconcile(&self) -> Result<(), DocumentsError> {
        if self.shutdown.is_cancelled() {
            return Ok(());
        }
        let targets = eligibility::eligible_targets(&self.database).await?;
        let eligible: HashMap<String, WatchTarget> = targets
            .into_iter()
            .map(|target| (target.agent_run_id.clone(), target))
            .collect();

        for target in self.stale(&eligible) {
            self.stop(&target);
        }
        for target in eligible.values() {
            self.start(target);
        }
        Ok(())
    }

    /// Supervise until shutdown. Reconciles immediately so a restart
    /// reconstructs its watchers before the first interval elapses.
    pub fn supervise(&self) {
        let supervisor = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(error) = supervisor.reconcile().await {
                    eprintln!("Ticketry could not reconcile document watchers: {error}");
                }
                tokio::select! {
                    () = supervisor.shutdown.cancelled() => break,
                    () = tokio::time::sleep(SUPERVISION_INTERVAL) => {}
                }
            }
        });
    }

    /// Stop every watcher. Called on application shutdown; repeating it is
    /// harmless, and no watcher can be started afterwards.
    pub fn stop_all(&self) {
        self.shutdown.cancel();
        self.live.lock().expect("the watcher set").clear();
    }

    /// How many watchers are live. Observable so a test can assert the
    /// one-per-run rule without reaching into the map.
    pub fn live_count(&self) -> usize {
        self.live.lock().expect("the watcher set").len()
    }

    /// The runs whose watcher must end: no longer eligible, or now pointed at
    /// a different design directory.
    fn stale(&self, eligible: &HashMap<String, WatchTarget>) -> Vec<String> {
        self.live
            .lock()
            .expect("the watcher set")
            .iter()
            .filter(|(run, watcher)| {
                eligible
                    .get(*run)
                    .is_none_or(|target| target.design_dir != watcher.design_dir)
            })
            .map(|(run, _)| run.clone())
            .collect()
    }

    fn stop(&self, agent_run_id: &str) {
        if let Some(watcher) = self
            .live
            .lock()
            .expect("the watcher set")
            .remove(agent_run_id)
        {
            watcher.cancel.cancel();
        }
    }

    /// Start one watcher, unless this run already has one.
    fn start(&self, target: &WatchTarget) {
        let mut live = self.live.lock().expect("the watcher set");
        if live.contains_key(&target.agent_run_id) {
            return;
        }
        let root = std::path::PathBuf::from(&target.design_dir);
        let Ok(watch) = self.watcher.watch(&root) else {
            // A directory that cannot be watched is not a failure of the
            // capability: the ordinary registry refresh still discovers its
            // documents, and the next pass tries again.
            eprintln!(
                "Ticketry could not watch a design directory for run {}",
                target.agent_run_id
            );
            return;
        };
        let cancel = self.shutdown.child_token();
        live.insert(
            target.agent_run_id.clone(),
            Watcher {
                cancel: cancel.clone(),
                design_dir: target.design_dir.clone(),
            },
        );
        let context = WatchContext {
            database: self.database.clone(),
            facts: self.facts.clone(),
            identity: target.identity.clone(),
            root,
            window: self.window,
        };
        tokio::spawn(watch_loop::run(context, watch, cancel));
    }
}
