use sea_orm::DatabaseConnection;

use super::status_compaction::StatusCompactionService;
use super::status_wakeup::StatusWakeup;
use super::{
    attempt_commands, attempt_queries, AgentRunRepository, AttemptOutcome,
    AutomationAttemptProjection, AutomationAttemptRepository, CompactionWatermarkRepository,
    LaunchEffectRepository, RunsPersistenceError, StatusEventRepository, TransitionOccurrence,
};

/// Composition root for authored Runs concerns. Transport layers receive the
/// narrow service they need rather than a database connection or generated
/// model mutator.
#[derive(Clone)]
pub struct RunsServices {
    lifecycle: LifecycleService,
    attempts: AttemptService,
    outbox: OutboxService,
    effects: EffectService,
    queries: QueryProjectionService,
    compatibility: CompatibilityService,
    stream: StatusStreamService,
    compaction: StatusCompactionService,
}

impl RunsServices {
    pub fn new(database: DatabaseConnection) -> Self {
        let wakeup = StatusWakeup::live_authority();
        let runs = AgentRunRepository::new(database.clone());
        let attempts = AutomationAttemptRepository::new(database.clone());
        let events = StatusEventRepository::new(database.clone(), wakeup.clone());
        let watermarks = CompactionWatermarkRepository::new(database.clone());
        let effects = LaunchEffectRepository::new(database.clone());
        let attempt_service = AttemptService {
            database: database.clone(),
            attempts: attempts.clone(),
            events: events.clone(),
        };
        let query_service = QueryProjectionService {
            database: database.clone(),
            runs: runs.clone(),
            attempts: attempts.clone(),
            events: events.clone(),
            watermarks: watermarks.clone(),
            effects: effects.clone(),
        };
        Self {
            lifecycle: LifecycleService {
                database: database.clone(),
                runs: runs.clone(),
                events: events.clone(),
            },
            attempts: attempt_service.clone(),
            outbox: OutboxService {
                events: events.clone(),
                watermarks: watermarks.clone(),
            },
            effects: EffectService {
                database: database.clone(),
                effects: effects.clone(),
                events: events.clone(),
                lifecycle: LifecycleService {
                    database: database.clone(),
                    runs: runs.clone(),
                    events: events.clone(),
                },
            },
            queries: query_service.clone(),
            compatibility: CompatibilityService { effects },
            compaction: StatusCompactionService::new(database, events.clone(), watermarks.clone()),
            stream: StatusStreamService {
                queries: query_service,
                attempts: attempt_service,
                events,
                watermarks,
                wakeup,
            },
        }
    }

    pub fn lifecycle(&self) -> &LifecycleService {
        &self.lifecycle
    }
    pub fn attempts(&self) -> &AttemptService {
        &self.attempts
    }
    pub fn outbox(&self) -> &OutboxService {
        &self.outbox
    }
    pub fn effects(&self) -> &EffectService {
        &self.effects
    }
    pub fn queries(&self) -> &QueryProjectionService {
        &self.queries
    }
    pub fn compatibility(&self) -> &CompatibilityService {
        &self.compatibility
    }
    pub fn stream(&self) -> &StatusStreamService {
        &self.stream
    }
    pub fn compaction(&self) -> &StatusCompactionService {
        &self.compaction
    }
}

/// Everything one project status subscription reads, and nothing it could
/// write with. It is installed in the schema as its own datum so the
/// subscription cannot reach a command service by accident.
#[derive(Clone)]
pub struct StatusStreamService {
    queries: QueryProjectionService,
    attempts: AttemptService,
    events: StatusEventRepository,
    watermarks: CompactionWatermarkRepository,
    wakeup: StatusWakeup,
}

impl StatusStreamService {
    pub(crate) fn queries(&self) -> &QueryProjectionService {
        &self.queries
    }
    pub(crate) fn attempts(&self) -> &AttemptService {
        &self.attempts
    }
    pub(crate) fn events(&self) -> &StatusEventRepository {
        &self.events
    }
    pub(crate) fn watermarks(&self) -> &CompactionWatermarkRepository {
        &self.watermarks
    }
    pub(crate) fn wakeup(&self) -> &StatusWakeup {
        &self.wakeup
    }
}

#[derive(Clone)]
pub struct LifecycleService {
    database: DatabaseConnection,
    runs: AgentRunRepository,
    events: StatusEventRepository,
}

impl LifecycleService {
    pub(crate) fn database(&self) -> &DatabaseConnection {
        &self.database
    }
    pub fn runs(&self) -> &AgentRunRepository {
        &self.runs
    }
    pub fn events(&self) -> &StatusEventRepository {
        &self.events
    }
}

#[derive(Clone)]
pub struct AttemptService {
    database: DatabaseConnection,
    attempts: AutomationAttemptRepository,
    events: StatusEventRepository,
}

impl AttemptService {
    pub fn attempts(&self) -> &AutomationAttemptRepository {
        &self.attempts
    }
    pub fn events(&self) -> &StatusEventRepository {
        &self.events
    }

    pub async fn materialize_root(
        &self,
        occurrence: &TransitionOccurrence,
    ) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
        attempt_commands::materialize_root(&self.database, &self.events, occurrence).await
    }

    pub async fn record_outcome(
        &self,
        attempt_id: &str,
        outcome: AttemptOutcome,
    ) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
        attempt_commands::record_outcome(&self.database, &self.events, attempt_id, outcome).await
    }

    pub async fn dismiss(
        &self,
        attempt_id: &str,
    ) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
        attempt_commands::dismiss(&self.database, &self.events, attempt_id).await
    }

    pub async fn retry(
        &self,
        attempt_id: &str,
    ) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
        attempt_commands::retry(&self.database, &self.events, attempt_id).await
    }

    pub async fn latest(
        &self,
        project_id: &str,
        task_id: Option<&str>,
    ) -> Result<Vec<AutomationAttemptProjection>, RunsPersistenceError> {
        attempt_queries::latest_attempts(&self.database, project_id, task_id).await
    }
}

#[derive(Clone)]
pub struct OutboxService {
    events: StatusEventRepository,
    watermarks: CompactionWatermarkRepository,
}

impl OutboxService {
    pub fn events(&self) -> &StatusEventRepository {
        &self.events
    }
    pub fn watermarks(&self) -> &CompactionWatermarkRepository {
        &self.watermarks
    }
}

#[derive(Clone)]
pub struct EffectService {
    database: DatabaseConnection,
    effects: LaunchEffectRepository,
    events: StatusEventRepository,
    lifecycle: LifecycleService,
}

impl EffectService {
    pub(crate) fn database(&self) -> &DatabaseConnection {
        &self.database
    }
    pub fn effects(&self) -> &LaunchEffectRepository {
        &self.effects
    }
    pub(crate) fn events(&self) -> &StatusEventRepository {
        &self.events
    }
    pub(crate) fn lifecycle(&self) -> &LifecycleService {
        &self.lifecycle
    }

    /// Bind the temporary terminal compatibility executor to this launch
    /// surface. The executor is supplied by the transport that owns it and is
    /// never stored on the shared service graph.
    pub fn dispatch_with(
        &self,
        executor: std::sync::Arc<dyn super::LaunchExecutor>,
    ) -> super::LaunchDispatchService {
        super::LaunchDispatchService::new(self.clone(), executor)
    }

    /// Bind the runtime probe and terminal executor that startup reconciliation
    /// needs. The probe observes the deterministic runtime identity; the
    /// executor performs only effects the probe proved absent.
    pub fn reconcile_with(
        &self,
        probe: std::sync::Arc<dyn super::LaunchRuntimeProbe>,
        executor: std::sync::Arc<dyn super::LaunchExecutor>,
    ) -> super::LaunchReconciliationService {
        super::LaunchReconciliationService::new(self.clone(), probe, executor)
    }
}

#[derive(Clone)]
pub struct QueryProjectionService {
    database: DatabaseConnection,
    runs: AgentRunRepository,
    attempts: AutomationAttemptRepository,
    events: StatusEventRepository,
    watermarks: CompactionWatermarkRepository,
    effects: LaunchEffectRepository,
}

impl QueryProjectionService {
    pub(crate) fn database(&self) -> &DatabaseConnection {
        &self.database
    }
    pub fn runs(&self) -> &AgentRunRepository {
        &self.runs
    }
    pub fn attempts(&self) -> &AutomationAttemptRepository {
        &self.attempts
    }
    pub fn events(&self) -> &StatusEventRepository {
        &self.events
    }
    pub fn watermarks(&self) -> &CompactionWatermarkRepository {
        &self.watermarks
    }
    pub fn effects(&self) -> &LaunchEffectRepository {
        &self.effects
    }
}

/// Temporary terminal/execution boundary. It exposes only durable effect
/// records, never raw SQL or a generic Runs model writer.
#[derive(Clone)]
pub struct CompatibilityService {
    effects: LaunchEffectRepository,
}

impl CompatibilityService {
    pub fn effects(&self) -> &LaunchEffectRepository {
        &self.effects
    }
}

#[cfg(test)]
mod tests {
    use super::super::schema::AUTHORED_TABLES;

    #[test]
    fn generated_crud_has_no_runs_tables() {
        // Runs tables are absent from graphql_foundation/entities and are
        // reachable only through the authored services above.
        let generated_entities = ["migration_probes"];
        assert!(AUTHORED_TABLES
            .iter()
            .all(|table| !generated_entities.contains(table)));
    }
}
