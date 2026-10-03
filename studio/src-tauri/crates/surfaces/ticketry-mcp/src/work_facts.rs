use sea_orm::DatabaseConnection;
use ticketry_work_management::commands::status_facts::WorkFactRecorder;

/// The MCP transport publishes through the same durable outbox as the GraphQL
/// surface. It composes its own recorder over its own connection: the committed
/// outbox row is the ordering authority, so a wake-up that does not reach the
/// other publisher's subscribers delays delivery to the next reread rather than
/// losing the fact.
pub(super) async fn work_facts(database: &DatabaseConnection) -> Option<WorkFactRecorder> {
    ticketry_runs::outbox_adopted(database).await.then(|| {
        WorkFactRecorder::new(
            ticketry_runs::RunsServices::new(database.clone())
                .outbox()
                .events()
                .clone(),
        )
    })
}
