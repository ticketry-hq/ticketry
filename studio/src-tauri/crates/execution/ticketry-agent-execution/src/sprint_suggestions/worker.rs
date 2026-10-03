use super::{process, publication, snapshot::Snapshot, SprintSuggestionExecutor};
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr,
    EntityTrait, IntoActiveModel, QueryFilter, Set, TransactionTrait,
};
use ticketry_entities::{agent_execution, agent_run};

pub(crate) async fn lock(txn: &impl ConnectionTrait, id: &str) -> Result<(), DbErr> {
    agent_execution::Entity::update_many()
        .col_expr(
            agent_execution::Column::State,
            Expr::col(agent_execution::Column::State),
        )
        .filter(agent_execution::Column::Id.eq(id))
        .exec(txn)
        .await?;
    Ok(())
}
pub(crate) async fn end_run(
    txn: &impl ConnectionTrait,
    id: &str,
    state: &str,
    error: Option<String>,
) -> Result<(), DbErr> {
    let now = chrono::Utc::now().to_rfc3339();
    agent_run::Entity::update_many()
        .col_expr(
            agent_run::Column::Status,
            Expr::value(if state == "succeeded" {
                "completed"
            } else {
                "failed"
            }),
        )
        .col_expr(agent_run::Column::EndedAt, Expr::value(Some(now.clone())))
        .col_expr(
            agent_run::Column::ExitCode,
            Expr::value(Some(if state == "succeeded" { 0 } else { 1 })),
        )
        .col_expr(agent_run::Column::Error, Expr::value(error))
        .col_expr(
            agent_run::Column::LifecycleState,
            Expr::value(Some("exited")),
        )
        .col_expr(
            agent_run::Column::LifecycleUpdatedAt,
            Expr::value(Some(now)),
        )
        .filter(agent_run::Column::Id.eq(id))
        .exec(txn)
        .await?;
    Ok(())
}
pub(crate) async fn recover(database: &DatabaseConnection) -> Result<(), DbErr> {
    let txn = database.begin().await?;
    let jobs = agent_execution::Entity::find()
        .filter(agent_execution::Column::State.is_in(["queued", "running"]))
        .all(&txn)
        .await?;
    for job in jobs {
        let message = "The application restarted before the agent finished. Retry to run it again.";
        end_run(&txn, &job.agent_run_id, "failed", Some(message.into())).await?;
        let mut active = job.into_active_model();
        active.state = Set("failed".into());
        active.error = Set(Some(message.into()));
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        active.update(&txn).await?;
    }
    txn.commit().await
}
pub(crate) async fn dispatch(service: SprintSuggestionExecutor) {
    let Ok(jobs) = agent_execution::Entity::find()
        .filter(agent_execution::Column::State.eq("queued"))
        .all(&service.database)
        .await
    else {
        return;
    };
    for job in jobs {
        let service = service.clone();
        tokio::spawn(async move {
            let Ok(claim) = agent_execution::Entity::update_many()
                .col_expr(agent_execution::Column::State, Expr::value("running"))
                .col_expr(
                    agent_execution::Column::UpdatedAt,
                    Expr::value(chrono::Utc::now().naive_utc()),
                )
                .filter(agent_execution::Column::Id.eq(&job.id))
                .filter(agent_execution::Column::State.eq("queued"))
                .filter(agent_execution::Column::CancelRequested.eq(false))
                .exec(&service.database)
                .await
            else {
                return;
            };
            if claim.rows_affected != 1 {
                return;
            }
            let result = async {
                let snapshot: Snapshot = serde_json::from_str(&job.input_snapshot)
                    .map_err(|_| "The planning snapshot is invalid.".to_owned())?;
                let output = process::run(&service, &job, &snapshot).await?;
                publication::publish(&service, &job, &snapshot, output).await
            }
            .await;
            if let Err(message) = result {
                let _ = fail(&service.database, &job.id, &message).await;
            }
        });
    }
}
async fn fail(database: &DatabaseConnection, id: &str, message: &str) -> Result<(), DbErr> {
    let txn = database.begin().await?;
    lock(&txn, id).await?;
    if let Some(row) = agent_execution::Entity::find_by_id(id)
        .one(&txn)
        .await?
        .filter(|j| j.state == "running")
    {
        end_run(&txn, &row.agent_run_id, "failed", Some(message.into())).await?;
        let mut active = row.into_active_model();
        active.state = Set("failed".into());
        active.error = Set(Some(message.into()));
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        active.update(&txn).await?;
    }
    txn.commit().await
}
