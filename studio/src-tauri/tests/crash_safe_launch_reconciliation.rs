//! Crash-safe launch-effect reconciliation and runtime adoption.
//!
//! Every case here injects a failure at one boundary — preparation, claim,
//! terminal creation, acknowledgement, attempt projection, cleanup, or restart
//! — and then asserts what an operator can observe afterwards: exactly one
//! deterministic runtime, one authoritative outcome, and no authoritative row
//! deleted while an external runtime might still exist.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use muxed_studio_lib::runs_persistence::{
    adopt, ClaimedLaunch, LaunchExecutor, LaunchExecutorFailure, LaunchIntent,
    LaunchRuntimeEvidence, LaunchRuntimeProbe, PrepareLaunchRequest, ReconciliationDecision,
    RunSnapshot, RunsServices, RuntimeIdentity, RuntimeObservation, TransitionOccurrence,
    RUNTIME_CONFLICT_CODE,
};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

const PROVIDER: &str = "codex";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

fn fixture(path: &Path) {
    let script = r#"
import os, sys, uuid
from pathlib import Path
p=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(p); os.environ['MUXED_DATA_DIR']=str(p.parent); os.environ['MUXED_FORCE_SQLITE']='true'
import django; django.setup()
from django.core.management import call_command
from worktracker.models import Workspace, Project, State, IssueType, Issue
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id=uuid.UUID(int=700),slug='reconcile-fixture',name='Reconcile Fixture')
project=Project.objects.create(id=uuid.UUID(int=701),workspace=w,name='Project 700',slug='P700')
state=State.objects.create(id=uuid.UUID(int=702),project=project,name='Todo',group='unstarted',sort_order=1)
kind=IssueType.objects.create(id=uuid.UUID(int=703),project=project,name='Story',level='task',sort_order=1,start_state=state)
Issue.objects.create(id=uuid.UUID(int=704),project=project,type='task',issue_type=kind,state=state,name='Reconcile fixture',sequence_id=700,rank='z')
"#;
    let output = Command::new(root().join("backend/.venv/bin/python"))
        .arg("-c")
        .arg(script)
        .arg(path)
        .current_dir(root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn adopted() -> (tempfile::TempDir, sea_orm::DatabaseConnection, RunsServices) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);
    adopt(directory.path()).await.unwrap();
    muxed_studio_lib::terminal_persistence::adopt(directory.path())
        .await
        .unwrap();
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap();
    let services = RunsServices::new(database.clone());
    (directory, database, services)
}

fn id(value: u128) -> String {
    uuid::Uuid::from_u128(value).hyphenated().to_string()
}

/// The database stores launch identities unhyphenated.
fn db_id(value: u128) -> String {
    uuid::Uuid::from_u128(value).simple().to_string()
}

fn intent(seed: u128, attempt: Option<String>) -> LaunchIntent {
    LaunchIntent {
        effect_id: id(seed),
        agent_run_id: format!("run-{seed}"),
        automation_attempt_id: attempt,
        request_id: format!("request-{seed}"),
        project_id: id(701),
        issue_id: id(704),
        scope: "task".to_owned(),
        provider: Some(PROVIDER.to_owned()),
        target_kind: "task".to_owned(),
        target_id: id(704),
        policy_reference: None,
    }
}

fn request(intent: LaunchIntent) -> PrepareLaunchRequest {
    PrepareLaunchRequest {
        intent,
        snapshot: RunSnapshot {
            model: Some("gpt-5".to_owned()),
            ..RunSnapshot::default()
        },
    }
}

async fn count(database: &sea_orm::DatabaseConnection, table: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT COUNT(*) AS count FROM {table}"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "count")
        .unwrap()
}

async fn expire_leases(database: &sea_orm::DatabaseConnection) {
    database
        .execute_unprepared(
            "UPDATE runs_launch_effects SET lease_expires_at='2000-01-01 00:00:00' \
             WHERE state='leased'",
        )
        .await
        .unwrap();
}

/// The external terminal world the deterministic identity addresses. It is the
/// single source of truth for both the executor that creates runtimes and the
/// probe that observes them, so "exactly one runtime" is a fact about this
/// world rather than an assertion about call counts alone.
#[derive(Clone, Default)]
struct TerminalWorld {
    runtimes: Arc<Mutex<BTreeSet<String>>>,
    creations: Arc<Mutex<Vec<String>>>,
}

impl TerminalWorld {
    fn runtime_id(agent_run_id: &str) -> String {
        format!("runtime-{agent_run_id}")
    }

    /// Create the deterministic runtime, failing loudly on a duplicate: a
    /// second coding session for one committed effect is the defect this slice
    /// exists to prevent.
    fn create(&self, agent_run_id: &str) -> String {
        let runtime_id = Self::runtime_id(agent_run_id);
        let inserted = self.runtimes.lock().unwrap().insert(runtime_id.clone());
        assert!(inserted, "{runtime_id} was created twice");
        self.creations.lock().unwrap().push(runtime_id.clone());
        runtime_id
    }

    /// A runtime created outside this effect's intent, e.g. by a foreign
    /// process that reused the deterministic identity.
    fn plant_foreign(&self, agent_run_id: &str) {
        self.runtimes
            .lock()
            .unwrap()
            .insert(Self::runtime_id(agent_run_id));
    }

    fn creations(&self) -> Vec<String> {
        self.creations.lock().unwrap().clone()
    }

    fn holds(&self, agent_run_id: &str) -> bool {
        self.runtimes
            .lock()
            .unwrap()
            .contains(&Self::runtime_id(agent_run_id))
    }
}

/// What the probe is allowed to conclude about the world. `Truthful` reads the
/// world; the others inject the observations a real probe can return.
#[derive(Clone, Copy, Eq, PartialEq)]
enum ProbeVerdict {
    Truthful,
    Conflicting,
    Uncertain,
}

#[derive(Clone)]
struct WorldProbe {
    world: TerminalWorld,
    verdict: ProbeVerdict,
    observed: Arc<Mutex<Vec<RuntimeIdentity>>>,
}

impl WorldProbe {
    fn new(world: TerminalWorld, verdict: ProbeVerdict) -> Self {
        Self {
            world,
            verdict,
            observed: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn observed(&self) -> Vec<RuntimeIdentity> {
        self.observed.lock().unwrap().clone()
    }
}

#[async_trait]
impl LaunchRuntimeProbe for WorldProbe {
    async fn observe(&self, identity: RuntimeIdentity) -> RuntimeObservation {
        self.observed.lock().unwrap().push(identity.clone());
        match self.verdict {
            ProbeVerdict::Uncertain => RuntimeObservation::Uncertain {
                detail: "The terminal host did not answer.".to_owned(),
            },
            ProbeVerdict::Conflicting => RuntimeObservation::Conflicting {
                runtime_id: TerminalWorld::runtime_id(&identity.agent_run_id),
                detail: "The runtime holds a different work item.".to_owned(),
            },
            ProbeVerdict::Truthful => {
                if self.world.holds(&identity.agent_run_id) {
                    RuntimeObservation::Live {
                        runtime_id: TerminalWorld::runtime_id(&identity.agent_run_id),
                    }
                } else {
                    RuntimeObservation::Absent
                }
            }
        }
    }
}

/// The temporary terminal capability. `crash_after_creation` models a process
/// that created the runtime and died before acknowledgement.
#[derive(Clone)]
struct WorldExecutor {
    world: TerminalWorld,
    crash_after_creation: bool,
    claims: Arc<Mutex<Vec<ClaimedLaunch>>>,
}

impl WorldExecutor {
    fn new(world: TerminalWorld) -> Self {
        Self {
            world,
            crash_after_creation: false,
            claims: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn crashing(world: TerminalWorld) -> Self {
        Self {
            crash_after_creation: true,
            ..Self::new(world)
        }
    }

    fn claims(&self) -> Vec<ClaimedLaunch> {
        self.claims.lock().unwrap().clone()
    }
}

#[async_trait]
impl LaunchExecutor for WorldExecutor {
    async fn execute(
        &self,
        claim: ClaimedLaunch,
    ) -> Result<LaunchRuntimeEvidence, LaunchExecutorFailure> {
        self.claims.lock().unwrap().push(claim.clone());
        let runtime_id = self.world.create(&claim.agent_run_id);
        if self.crash_after_creation {
            // The runtime exists, but this process never proves it. Cleanup is
            // explicitly unconfirmed, so the effect stays reconcilable.
            return Err(LaunchExecutorFailure {
                code: "acknowledgement_lost".to_owned(),
                message: "The executor died after creating the terminal.".to_owned(),
                retryable: true,
                cleanup_confirmed: false,
            });
        }
        Ok(LaunchRuntimeEvidence {
            runtime_id,
            adopted: false,
        })
    }
}

/// A prepared effect nobody claimed is drained on the next start, and only
/// after the probe proves no runtime already exists.
#[tokio::test]
async fn startup_drains_prepared_effects_after_observing_the_runtime() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    let probe = WorldProbe::new(world.clone(), ProbeVerdict::Truthful);
    let executor = WorldExecutor::new(world.clone());
    services
        .effects()
        .prepare_launch(request(intent(1100, None)))
        .await
        .unwrap();

    let reconciler = services
        .effects()
        .reconcile_with(Arc::new(probe.clone()), Arc::new(executor.clone()));
    let report = reconciler.reconcile().await.unwrap();

    assert_eq!(
        report.decision(&id(1100)),
        Some(&ReconciliationDecision::Executed {
            state: "applied".to_owned()
        })
    );
    // The runtime was observed before it was created, never the other way
    // round.
    assert_eq!(probe.observed().len(), 1);
    assert_eq!(probe.observed()[0].agent_run_id, "run-1100");
    assert_eq!(world.creations(), vec!["runtime-run-1100".to_owned()]);
    assert_eq!(count(&database, "agent_runs").await, 1);

    // A second pass has nothing left to do.
    let repeated = reconciler.reconcile().await.unwrap();
    assert!(repeated.reconciled.is_empty());
    assert_eq!(world.creations().len(), 1);
}

/// Failure after terminal creation but before acknowledgement: the runtime
/// exists, the effect does not know it, and reconciliation adopts rather than
/// spawning a second session.
#[tokio::test]
async fn a_live_matching_runtime_is_adopted_under_its_predetermined_run_identity() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    let prepared = services
        .effects()
        .prepare_launch(request(intent(1101, None)))
        .await
        .unwrap();
    // The crashed process claimed the effect, created the terminal, and died
    // before it could acknowledge anything.
    let claim = services
        .effects()
        .claim(&prepared.effect.effect_id, "crashed-owner", 60)
        .await
        .unwrap();
    WorldExecutor::new(world.clone())
        .execute(claim)
        .await
        .unwrap();
    expire_leases(&database).await;
    assert!(world.holds("run-1101"), "the terminal survived the crash");

    let probe = WorldProbe::new(world.clone(), ProbeVerdict::Truthful);
    let executor = WorldExecutor::new(world.clone());
    let report = services
        .effects()
        .reconcile_with(Arc::new(probe), Arc::new(executor.clone()))
        .reconcile()
        .await
        .unwrap();

    assert_eq!(
        report.decision(&id(1101)),
        Some(&ReconciliationDecision::Adopted {
            runtime_id: "runtime-run-1101".to_owned()
        })
    );
    let effect = services
        .effects()
        .effects()
        .find(&db_id(1101))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "applied");
    assert_eq!(effect.agent_run_id, "run-1101");
    assert!(effect.applied_at.is_some());
    assert!(effect
        .runtime_evidence
        .as_deref()
        .unwrap()
        .contains(r#""adopted":true"#));
    assert!(
        executor.claims().is_empty(),
        "an adopted runtime is never executed a second time"
    );
    assert_eq!(world.creations().len(), 1);
    assert_eq!(count(&database, "agent_runs").await, 1);
    assert_eq!(count(&database, "runs_launch_effects").await, 1);
}

/// Lease expiry alone is not permission to respawn: with the runtime
/// unobservable, the abandoned claim is left exactly as it was.
#[tokio::test]
async fn an_expired_lease_with_an_unobservable_runtime_spawns_nothing() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    let prepared = services
        .effects()
        .prepare_launch(request(intent(1102, None)))
        .await
        .unwrap();
    services
        .effects()
        .claim(&prepared.effect.effect_id, "crashed-owner", 60)
        .await
        .unwrap();
    expire_leases(&database).await;

    let executor = WorldExecutor::new(world.clone());
    let report = services
        .effects()
        .reconcile_with(
            Arc::new(WorldProbe::new(world.clone(), ProbeVerdict::Uncertain)),
            Arc::new(executor.clone()),
        )
        .reconcile()
        .await
        .unwrap();

    assert!(matches!(
        report.decision(&id(1102)),
        Some(ReconciliationDecision::Deferred { .. })
    ));
    assert!(executor.claims().is_empty());
    assert!(world.creations().is_empty());
    let effect = services
        .effects()
        .effects()
        .find(&db_id(1102))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "leased");
    assert_eq!(
        effect.attempt_count, 1,
        "an undecided pass consumes no attempt"
    );
    assert_eq!(effect.lease_owner.as_deref(), Some("crashed-owner"));
}

/// A runtime that contradicts the immutable intent is never adopted, never
/// overwritten, and never retried.
#[tokio::test]
async fn a_conflicting_runtime_becomes_a_durable_non_retryable_failure() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    world.plant_foreign("run-1103");
    let attempt = services
        .attempts()
        .materialize_root(&TransitionOccurrence {
            occurrence_id: id(1150),
            issue_id: id(704),
            project_id: id(701),
            from_state_id: id(702),
            to_state_id: id(702),
            workflow_revision: 7,
        })
        .await
        .unwrap();
    services
        .effects()
        .prepare_launch(request(intent(1103, Some(attempt.attempt_id.clone()))))
        .await
        .unwrap();

    let executor = WorldExecutor::new(world.clone());
    let reconciler = services.effects().reconcile_with(
        Arc::new(WorldProbe::new(world.clone(), ProbeVerdict::Conflicting)),
        Arc::new(executor.clone()),
    );
    let report = reconciler.reconcile().await.unwrap();

    assert_eq!(
        report.decision(&id(1103)),
        Some(&ReconciliationDecision::Conflicted {
            runtime_id: "runtime-run-1103".to_owned()
        })
    );
    let effect = services
        .effects()
        .effects()
        .find(&db_id(1103))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "failed");
    assert_eq!(
        effect.last_error_code.as_deref(),
        Some(RUNTIME_CONFLICT_CODE)
    );
    assert!(effect
        .runtime_evidence
        .as_deref()
        .unwrap()
        .contains("runtime-run-1103"));
    assert!(effect.applied_at.is_none());

    let projected = services
        .attempts()
        .attempts()
        .find(&attempt.attempt_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(projected.status, "failed");
    assert!(!projected.retryable, "a conflict is never retried");

    // The foreign runtime is untouched and the settled effect leaves the
    // backlog for good.
    assert!(world.holds("run-1103"));
    assert!(reconciler.reconcile().await.unwrap().reconciled.is_empty());
    assert!(executor.claims().is_empty());
    assert_eq!(count(&database, "runs_launch_effects").await, 1);
}

/// Cleanup that could not be proven keeps its authoritative rows and is
/// reconciled again until the runtime is provably gone.
#[tokio::test]
async fn unproven_cleanup_stays_pending_with_durable_evidence() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    services
        .effects()
        .dispatch_with(Arc::new(WorldExecutor::crashing(world.clone())))
        .launch(request(intent(1104, None)))
        .await
        .unwrap();
    let effect = services
        .effects()
        .effects()
        .find(&db_id(1104))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "cleanup_pending");

    let executor = WorldExecutor::new(world.clone());
    let reconciler = services.effects().reconcile_with(
        Arc::new(WorldProbe::new(world.clone(), ProbeVerdict::Truthful)),
        Arc::new(executor.clone()),
    );

    // The runtime still exists: cleanup stays pending and nothing is deleted.
    assert_eq!(
        reconciler.reconcile().await.unwrap().decision(&id(1104)),
        Some(&ReconciliationDecision::CleanupPending)
    );
    let pending = services
        .effects()
        .effects()
        .find(&db_id(1104))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pending.state, "cleanup_pending");
    assert!(pending
        .runtime_evidence
        .as_deref()
        .unwrap()
        .contains("runtime-run-1104"));
    assert_eq!(
        pending.last_error_code.as_deref(),
        Some("acknowledgement_lost"),
        "the typed failure survives cleanup passes"
    );
    assert_eq!(count(&database, "runs_launch_effects").await, 1);
    assert_eq!(count(&database, "agent_runs").await, 1);

    // The operator ends the surviving terminal; the next pass settles cleanup.
    world.runtimes.lock().unwrap().remove("runtime-run-1104");
    assert_eq!(
        reconciler.reconcile().await.unwrap().decision(&id(1104)),
        Some(&ReconciliationDecision::CleanupCompleted)
    );
    let settled = services
        .effects()
        .effects()
        .find(&db_id(1104))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(settled.state, "failed");
    assert!(reconciler.reconcile().await.unwrap().reconciled.is_empty());
    assert!(
        executor.claims().is_empty(),
        "cleanup never re-executes the launch"
    );
}

/// Failure after acknowledgement but before attempt projection: the whole
/// outcome rolls back, and reconciliation converges on the runtime that exists.
#[tokio::test]
async fn a_rolled_back_acknowledgement_converges_on_one_runtime_and_one_outcome() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    let attempt = services
        .attempts()
        .materialize_root(&TransitionOccurrence {
            occurrence_id: id(1160),
            issue_id: id(704),
            project_id: id(701),
            from_state_id: id(702),
            to_state_id: id(702),
            workflow_revision: 7,
        })
        .await
        .unwrap();

    database
        .execute_unprepared(
            "CREATE TRIGGER reject_projection BEFORE UPDATE ON automation_attempts \
             BEGIN SELECT RAISE(ABORT, 'projection crash'); END",
        )
        .await
        .unwrap();
    let executor = WorldExecutor::new(world.clone());
    assert!(services
        .effects()
        .dispatch_with(Arc::new(executor.clone()))
        .launch(request(intent(1105, Some(attempt.attempt_id.clone()))))
        .await
        .is_err());
    assert!(
        world.holds("run-1105"),
        "the terminal outlived the failed acknowledgement"
    );
    let stranded = services
        .effects()
        .effects()
        .find(&db_id(1105))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stranded.state, "leased", "the outcome rolled back whole");

    database
        .execute_unprepared("DROP TRIGGER reject_projection")
        .await
        .unwrap();
    expire_leases(&database).await;

    let report = services
        .effects()
        .reconcile_with(
            Arc::new(WorldProbe::new(world.clone(), ProbeVerdict::Truthful)),
            Arc::new(WorldExecutor::new(world.clone())),
        )
        .reconcile()
        .await
        .unwrap();

    assert!(matches!(
        report.decision(&id(1105)),
        Some(ReconciliationDecision::Adopted { .. })
    ));
    let effect = services
        .effects()
        .effects()
        .find(&db_id(1105))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "applied");
    let projected = services
        .attempts()
        .attempts()
        .find(&attempt.attempt_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(projected.status, "succeeded");
    assert_eq!(projected.agent_run_id.as_deref(), Some("run-1105"));
    assert_eq!(world.creations().len(), 1);
    assert_eq!(count(&database, "agent_runs").await, 1);
}

/// Concurrent reconcilers — the restart-storm case — settle on one runtime and
/// one authoritative outcome.
#[tokio::test]
async fn concurrent_reconcilers_create_exactly_one_deterministic_runtime() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    for seed in [1106u128, 1107] {
        services
            .effects()
            .prepare_launch(request(intent(seed, None)))
            .await
            .unwrap();
    }

    let executor = Arc::new(WorldExecutor::new(world.clone()));
    let workers = (0..4).map(|_| {
        let reconciler = services.effects().reconcile_with(
            Arc::new(WorldProbe::new(world.clone(), ProbeVerdict::Truthful)),
            executor.clone(),
        );
        tokio::spawn(async move { reconciler.reconcile().await.unwrap() })
    });
    let mut executed = 0;
    for worker in workers {
        executed += worker
            .await
            .unwrap()
            .reconciled
            .iter()
            .filter(|entry| {
                matches!(
                    entry.decision,
                    ReconciliationDecision::Executed { .. }
                        | ReconciliationDecision::Adopted { .. }
                )
            })
            .count();
    }

    assert_eq!(executed, 2, "each effect settles exactly once");
    let mut creations = world.creations();
    creations.sort();
    assert_eq!(
        creations,
        vec!["runtime-run-1106".to_owned(), "runtime-run-1107".to_owned()]
    );
    assert_eq!(count(&database, "runs_launch_effects").await, 2);
    assert_eq!(count(&database, "agent_runs").await, 2);
    for seed in [1106u128, 1107] {
        assert_eq!(
            services
                .effects()
                .effects()
                .find(&db_id(seed))
                .await
                .unwrap()
                .unwrap()
                .state,
            "applied"
        );
    }
}

/// Diagnostics survive every boundary, and none of them is command material.
#[tokio::test]
async fn reconciliation_diagnostics_stay_durable_without_secrets() {
    let (_directory, database, services) = adopted().await;
    let world = TerminalWorld::default();
    let prepared = services
        .effects()
        .prepare_launch(request(intent(1108, None)))
        .await
        .unwrap();
    services
        .effects()
        .claim(&prepared.effect.effect_id, "crashed-owner", 60)
        .await
        .unwrap();
    expire_leases(&database).await;

    let probe = WorldProbe::new(world.clone(), ProbeVerdict::Truthful);
    services
        .effects()
        .reconcile_with(
            Arc::new(probe.clone()),
            Arc::new(WorldExecutor::new(world.clone())),
        )
        .reconcile()
        .await
        .unwrap();

    // The probe is told the identities and the immutable intent, and nothing
    // that could launch anything.
    let observed = probe.observed();
    assert_eq!(observed.len(), 1);
    let seen = format!("{:?}", observed[0]);
    for forbidden in ["command", "prompt", "token", "env", "gpt-5"] {
        assert!(!seen.contains(forbidden), "{forbidden} reached the probe");
    }

    let effect = services
        .effects()
        .effects()
        .find(&db_id(1108))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "applied");
    assert_eq!(
        effect.attempt_count, 2,
        "claims stay durable across reconciliation"
    );
    assert!(effect.runtime_evidence.is_some());
    assert!(effect.lease_owner.is_none());
    assert!(effect.lease_expires_at.is_none());
    let row: String = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT group_concat(runtime_evidence, '|') AS evidence FROM runs_launch_effects",
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "evidence")
        .unwrap();
    for forbidden in ["command", "prompt", "token", "gpt-5"] {
        assert!(!row.contains(forbidden), "{forbidden} was persisted");
    }
}
