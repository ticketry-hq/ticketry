use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, TransactionTrait};

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let txn = database.begin().await?;
    txn.execute_unprepared(
        "CREATE TABLE IF NOT EXISTS agent_executions (
          id varchar(64) PRIMARY KEY NOT NULL,
          client_request_id varchar(64) UNIQUE NOT NULL,
          agent_run_id varchar(64) UNIQUE NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          sprint_id char(32) NOT NULL REFERENCES worktracker_sprint(id) ON DELETE CASCADE,
          output_type varchar(64) NOT NULL CHECK(output_type = 'sprint_suggestions_v1'),
          input_snapshot text NOT NULL CHECK(json_valid(input_snapshot)),
          goals_revision datetime NULL,
          state varchar(16) NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
          error text NULL,
          cancel_requested boolean NOT NULL DEFAULT 0,
          created_at datetime NOT NULL,
          updated_at datetime NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS agent_executions_active_sprint
          ON agent_executions(sprint_id) WHERE state IN ('queued','running');"
    ).await?;
    txn.commit().await
}
