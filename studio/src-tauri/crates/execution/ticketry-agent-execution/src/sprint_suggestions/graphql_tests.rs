use super::{process_tests, test_fixture::*, views, SprintSuggestionExecutor};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use seaography::{
    async_graphql::{Request, Variables},
    Builder, BuilderContext,
};
use ticketry_entities::{agent_execution, agent_run, session, sprint_suggestion};

#[tokio::test]
#[cfg(unix)]
async fn model_create_restricts_reissued_credentials_for_current_and_replaced_runs() {
    use sea_orm::ConnectionTrait;
    let (db, dir) = fixture().await;
    let previous = "60000000000000000000000000000001";
    db.execute_unprepared(&format!(
        "INSERT INTO agent_runs (id,issue_id,status,started_at,scope,launch_unattended) VALUES
         ('{previous}','{MODULE}','running','2026-01-01T00:00:00Z','exec',0);
         UPDATE worktracker_sprint SET suggestion_run_id='{previous}' WHERE id='{SPRINT}';"
    ))
    .await
    .unwrap();
    let mut service = SprintSuggestionExecutor::new(db.clone(), dir.path().to_owned());
    service.program = Some(process_tests::script(dir.path(), "exec sleep 30").await);
    let context = Box::leak(Box::new(BuilderContext::default()));
    let mut builder =
        ticketry_entities::register_work_management_entities(Builder::new(context, db.clone()));
    seaography::register_entity!(builder, agent_run, mutation: false);
    seaography::register_entity!(builder, session, mutation: false);
    let builder = ticketry_entities::register_execution_entities(builder);
    let schema = views::register(builder)
        .schema_builder()
        .data(db.clone())
        .data(service)
        .finish()
        .unwrap();
    let response = schema.execute(Request::new(
        "mutation($p:String!,$s:String!,$r:String!){agent_execution_create(project_id:$p,sprint_id:$s,client_request_id:$r){agentRunId}}"
    ).variables(Variables::from_json(serde_json::json!({
        "p": PROJECT, "s": SPRINT, "r": uuid::Uuid::new_v4().to_string()
    })))).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let result = response.data.into_json().unwrap();
    let current = result["agent_execution_create"]["agentRunId"]
        .as_str()
        .unwrap();
    let authority = ticketry_runs::RunAuthority::new(db.clone());
    for run_id in [previous, current] {
        let credential = authority
            .issue(
                run_id,
                [
                    "create_task",
                    "update_task",
                    "list_tasks",
                    "terminate_current_run",
                ]
                .map(str::to_owned),
            )
            .await
            .unwrap();
        for tool in ["create_task", "update_task"] {
            let denial = authority
                .authorize(Some(&credential), tool)
                .await
                .unwrap_err();
            assert_eq!(denial.0["error"], "tool_not_allowed", "{run_id}: {tool}");
        }
        for tool in ["list_tasks", "terminate_current_run"] {
            assert!(
                authority.authorize(Some(&credential), tool).await.is_ok(),
                "{run_id}: {tool}"
            );
        }
    }
    db.execute_unprepared("UPDATE agent_executions SET state='cancelled', cancel_requested=1")
        .await
        .unwrap();
}

#[tokio::test]
#[cfg(unix)]
async fn model_create_drives_typed_exec_and_keeps_terminal_sessions_empty() {
    let (db, dir) = fixture().await;
    // The terminal table exists solely to prove that execution never writes it.
    let ddl = sea_orm::Schema::new(sea_orm::DbBackend::Sqlite);
    use sea_orm::ConnectionTrait;
    db.execute_raw(
        sea_orm::DbBackend::Sqlite.build(&ddl.create_table_from_entity(session::Entity)),
    )
    .await
    .unwrap();
    let mut service = SprintSuggestionExecutor::new(db.clone(), dir.path().to_owned());
    service.program = Some(process_tests::script(dir.path(), "exit 0").await);
    let context = Box::leak(Box::new(BuilderContext::default()));
    let mut builder =
        ticketry_entities::register_work_management_entities(Builder::new(context, db.clone()));
    seaography::register_entity!(builder, agent_run, mutation: false);
    seaography::register_entity!(builder, session, mutation: false);
    let builder = ticketry_entities::register_execution_entities(builder);
    let schema = views::register(builder)
        .schema_builder()
        .data(db.clone())
        .data(service)
        .finish()
        .unwrap();
    let sdl = schema.sdl();
    assert!(!sdl.contains("agentExecutionsCreateOne"));
    assert!(!sdl.contains("inputSnapshot:"));
    assert!(!sdl.contains("clientRequestId:"));
    assert!(sdl.contains("cancel_requested: Boolean!"));
    let request_id = uuid::Uuid::new_v4().to_string();
    let mutation = "mutation($p:String!,$s:String!,$r:String!){agent_execution_create(project_id:$p,sprint_id:$s,client_request_id:$r){id state outputType}}";
    let run = || {
        Request::new(mutation).variables(Variables::from_json(
            serde_json::json!({"p":PROJECT,"s":SPRINT,"r":request_id}),
        ))
    };
    let response = schema.execute(run()).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let id = response.data.into_json().unwrap()["agent_execution_create"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let job = agent_execution::Entity::find_by_id(&id)
                .one(&db)
                .await
                .unwrap()
                .unwrap();
            if job.state == "succeeded" {
                break;
            }
            assert_ne!(job.state, "failed", "{:?}", job.error);
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let repeated = schema.execute(run()).await;
    assert!(repeated.errors.is_empty(), "{:?}", repeated.errors);
    assert_eq!(
        repeated.data.into_json().unwrap()["agent_execution_create"]["id"],
        id
    );
    assert_eq!(
        agent_execution::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        sprint_suggestion::Entity::find()
            .filter(sprint_suggestion::Column::RunId.eq(&id))
            .all(&db)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(session::Entity::find().all(&db).await.unwrap().is_empty());
    process_tests::script(dir.path(), "exec sleep 30").await;
    let second = schema
        .execute(Request::new(mutation).variables(Variables::from_json(
            serde_json::json!({"p":PROJECT,"s":SPRINT,"r":uuid::Uuid::new_v4().to_string()}),
        )))
        .await;
    assert!(second.errors.is_empty(), "{:?}", second.errors);
    let second_id = second.data.into_json().unwrap()["agent_execution_create"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let cancel = schema.execute(Request::new(
        "mutation($p:String!,$id:String!){agent_execution_update(project_id:$p,id:$id,cancel_requested:true){id state cancelRequested}}"
    ).variables(Variables::from_json(serde_json::json!({"p":PROJECT,"id":second_id})))).await;
    assert!(cancel.errors.is_empty(), "{:?}", cancel.errors);
    let cancelled = cancel.data.into_json().unwrap();
    assert_eq!(cancelled["agent_execution_update"]["state"], "cancelled");
    assert_eq!(cancelled["agent_execution_update"]["cancelRequested"], true);
}
