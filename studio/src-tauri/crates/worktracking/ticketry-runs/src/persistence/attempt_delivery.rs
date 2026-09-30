//! Durable record of how a transition handoff reached its agent session.
//!
//! The write is once-only. An attempt that already published a delivery keeps
//! it: repeating the same delivery is the same history and appends no second
//! status event, and claiming a different one is a conflict rather than a
//! silent rewrite of what subscribers were already told.

use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait,
};

use super::attempt_commands::{append_attempt_event, attempt_with_project, conflict, now};
use super::attempt_queries::{database_uuid, project};
use super::entities::automation_attempt as automation_attempt_entity;
use super::{
    AutomationAttemptProjection, DeliveryMode, RunsPersistenceError, StatusEventRepository,
};

/// The status event kind published when a delivery is first recorded.
pub(crate) const DELIVERY_EVENT_KIND: &str = "automation_attempt_delivery";

pub async fn record_delivery_mode(
    database: &DatabaseConnection,
    events: &StatusEventRepository,
    attempt_id: &str,
    mode: DeliveryMode,
) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
    let attempt_id = database_uuid(attempt_id)?;
    let transaction = database.begin().await?;
    let (current, project_id) = attempt_with_project(&transaction, &attempt_id).await?;
    if let Some(recorded) = current.delivery_mode.as_deref() {
        transaction.commit().await?;
        if recorded == mode.as_str() {
            return project(current);
        }
        return Err(already_recorded());
    }
    let changed_at = now();
    let changed = automation_attempt_entity::Entity::update_many()
        .col_expr(
            automation_attempt_entity::Column::DeliveryMode,
            Expr::value(mode.as_str()),
        )
        .col_expr(
            automation_attempt_entity::Column::UpdatedAt,
            Expr::value(changed_at),
        )
        .filter(automation_attempt_entity::Column::Id.eq(&attempt_id))
        .filter(automation_attempt_entity::Column::DeliveryMode.is_null())
        .exec(&transaction)
        .await?
        .rows_affected
        == 1;
    let (attempt, _) = attempt_with_project(&transaction, &attempt_id).await?;
    if !changed {
        // A concurrent writer took the single write. Its value is the
        // published one, so this caller reports agreement or conflict against
        // committed history rather than overwriting it.
        transaction.commit().await?;
        if attempt.delivery_mode.as_deref() == Some(mode.as_str()) {
            return project(attempt);
        }
        return Err(already_recorded());
    }
    append_attempt_event(
        events,
        &transaction,
        &project_id,
        DELIVERY_EVENT_KIND,
        &attempt,
    )
    .await?;
    transaction.commit().await?;
    events.wake_committed();
    project(attempt)
}

fn already_recorded() -> RunsPersistenceError {
    conflict("Automation Attempt delivery is already recorded")
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

    use super::super::{
        DeliveryMode, RunsPersistenceErrorCode, RunsServices, TransitionOccurrence,
    };
    use super::DELIVERY_EVENT_KIND;

    const ISSUE: u128 = 0x51CE_0001;
    const PROJECT: u128 = 0x51CE_0002;
    const STATE: u128 = 0x51CE_0003;
    const OCCURRENCE: u128 = 0x51CE_0004;

    fn public_id(value: u128) -> String {
        uuid::Uuid::from_u128(value).hyphenated().to_string()
    }

    fn database_id(value: u128) -> String {
        uuid::Uuid::from_u128(value).simple().to_string()
    }

    /// The smallest store the attempt commands read and write: one WorkItem to
    /// scope the attempt, the adopted attempt table at its reconciled shape,
    /// and the authored status outbox.
    async fn store() -> DatabaseConnection {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        database
            .execute_unprepared(
                "CREATE TABLE worktracker_issue (\n\
                     id char(32) PRIMARY KEY,\n\
                     project_id char(32) NOT NULL,\n\
                     type varchar(32) NOT NULL,\n\
                     module_id char(32) NULL\n\
                 );\n\
                 CREATE TABLE automation_attempts (\n\
                     id char(32) PRIMARY KEY,\n\
                     transition_id char(32) NOT NULL,\n\
                     issue_id char(32) NOT NULL,\n\
                     from_state_id char(32) NOT NULL,\n\
                     to_state_id char(32) NOT NULL,\n\
                     workflow_revision integer NOT NULL,\n\
                     status varchar(32) NOT NULL,\n\
                     agent varchar NULL,\n\
                     agent_run_id varchar NULL,\n\
                     delivery_mode varchar(16) NULL,\n\
                     error text NULL,\n\
                     error_details text NULL,\n\
                     retryable bool NOT NULL DEFAULT 1,\n\
                     dismissed_at datetime NULL,\n\
                     retry_of_id char(32) NULL,\n\
                     root_attempt_id char(32) NULL,\n\
                     created_at datetime NOT NULL,\n\
                     updated_at datetime NOT NULL\n\
                 );",
            )
            .await
            .unwrap();
        database
            .execute_unprepared(super::super::schema::FOCUSED_SCHEMA)
            .await
            .unwrap();
        database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO worktracker_issue (id, project_id, type) VALUES (?, ?, 'task')",
                [database_id(ISSUE).into(), database_id(PROJECT).into()],
            ))
            .await
            .unwrap();
        database
    }

    fn occurrence() -> TransitionOccurrence {
        TransitionOccurrence {
            occurrence_id: public_id(OCCURRENCE),
            issue_id: public_id(ISSUE),
            project_id: public_id(PROJECT),
            from_state_id: public_id(STATE),
            to_state_id: public_id(STATE),
            workflow_revision: 3,
        }
    }

    async fn stored_delivery(database: &DatabaseConnection) -> Option<String> {
        database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT delivery_mode FROM automation_attempts".to_owned(),
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get::<Option<String>>("", "delivery_mode")
            .unwrap()
    }

    async fn delivery_events(database: &DatabaseConnection) -> i64 {
        database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT COUNT(*) AS count FROM runs_status_events WHERE event_kind = ?",
                [DELIVERY_EVENT_KIND.into()],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get::<i64>("", "count")
            .unwrap()
    }

    #[tokio::test]
    async fn a_continued_delivery_is_recorded_once_and_published_once() {
        let database = store().await;
        let services = RunsServices::new(database.clone());
        let attempt = services
            .attempts()
            .materialize_root(&occurrence())
            .await
            .unwrap();
        assert_eq!(attempt.delivery_mode, None);

        let recorded = services
            .attempts()
            .record_delivery_mode(&attempt.attempt_id, DeliveryMode::Continued)
            .await
            .unwrap();
        assert_eq!(recorded.delivery_mode.as_deref(), Some("continued"));
        assert_eq!(
            stored_delivery(&database).await.as_deref(),
            Some("continued")
        );
        assert_eq!(delivery_events(&database).await, 1);

        // The same delivery is the same history, so a repeat publishes nothing
        // new while still answering with the recorded fact.
        let repeated = services
            .attempts()
            .record_delivery_mode(&attempt.attempt_id, DeliveryMode::Continued)
            .await
            .unwrap();
        assert_eq!(repeated.delivery_mode.as_deref(), Some("continued"));
        assert_eq!(delivery_events(&database).await, 1);
    }

    #[tokio::test]
    async fn a_fresh_start_is_a_distinct_recorded_delivery() {
        let database = store().await;
        let services = RunsServices::new(database.clone());
        let attempt = services
            .attempts()
            .materialize_root(&occurrence())
            .await
            .unwrap();

        let recorded = services
            .attempts()
            .record_delivery_mode(&attempt.attempt_id, DeliveryMode::StartedFresh)
            .await
            .unwrap();
        assert_eq!(recorded.delivery_mode.as_deref(), Some("started_fresh"));
        assert_eq!(
            stored_delivery(&database).await.as_deref(),
            Some("started_fresh")
        );
        assert_eq!(delivery_events(&database).await, 1);
    }

    #[tokio::test]
    async fn a_conflicting_delivery_cannot_rewrite_published_history() {
        let database = store().await;
        let services = RunsServices::new(database.clone());
        let attempt = services
            .attempts()
            .materialize_root(&occurrence())
            .await
            .unwrap();
        services
            .attempts()
            .record_delivery_mode(&attempt.attempt_id, DeliveryMode::Continued)
            .await
            .unwrap();

        let refused = services
            .attempts()
            .record_delivery_mode(&attempt.attempt_id, DeliveryMode::StartedFresh)
            .await
            .expect_err("a second delivery contradicts the published one");
        assert_eq!(refused.code(), RunsPersistenceErrorCode::Conflict);
        assert_eq!(
            stored_delivery(&database).await.as_deref(),
            Some("continued")
        );
        assert_eq!(delivery_events(&database).await, 1);
    }
}
