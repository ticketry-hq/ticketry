use sea_orm::DatabaseConnection;

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
}

impl RunsServices {
    pub fn new(database: DatabaseConnection) -> Self {
        let runs = AgentRunRepository::new(database.clone());
        let attempts = AutomationAttemptRepository::new(database.clone());
        let events = StatusEventRepository::new(database.clone());
        let watermarks = CompactionWatermarkRepository::new(database.clone());
        let effects = LaunchEffectRepository::new(database.clone());
        Self {
            lifecycle: LifecycleService {
                database: database.clone(),
                runs: runs.clone(),
                events: events.clone(),
            },
            attempts: AttemptService {
                database: database.clone(),
                attempts: attempts.clone(),
                events: events.clone(),
            },
            outbox: OutboxService {
                events: events.clone(),
                watermarks: watermarks.clone(),
            },
            effects: EffectService {
                effects: effects.clone(),
            },
            queries: QueryProjectionService {
                database: database.clone(),
                runs,
                attempts,
                events,
                watermarks,
                effects: effects.clone(),
            },
            compatibility: CompatibilityService { effects },
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
    effects: LaunchEffectRepository,
}

impl EffectService {
    pub fn effects(&self) -> &LaunchEffectRepository {
        &self.effects
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
