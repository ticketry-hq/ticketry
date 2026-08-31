use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectionTrait, Database, DatabaseConnection, EntityTrait,
};
use seaography::{
    async_graphql::{
        dynamic::{Object, Schema},
        Request, Variables,
    },
    Builder, BuilderContext,
};
use ticketry_entities::terminals::{session, viewer_lease};
use ticketry_terminal::viewer_ownership::{
    CreateViewerLease, DeleteViewerLease, PreparedViewerMechanics, UpdateViewerLease,
    ViewerDetachReason, ViewerOwnershipError, ViewerOwnershipErrorCode, ViewerOwnershipService,
};

const RUN_ID: &str = "run-viewer-ownership";
const OTHER_RUN_ID: &str = "run-viewer-ownership-2";

#[derive(Default)]
struct Mechanics {
    detaches: Mutex<Vec<ViewerDetachReason>>,
}

impl PreparedViewerMechanics for Mechanics {
    fn detach(&self, reason: ViewerDetachReason) {
        self.detaches.lock().unwrap().push(reason);
    }
}

impl Mechanics {
    fn reasons(&self) -> Vec<ViewerDetachReason> {
        self.detaches.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn failed_mechanics_preserve_the_incumbent() {
    let database = fixture().await;
    let service = ViewerOwnershipService::new(database.clone());
    let incumbent = Arc::new(Mechanics::default());
    let current = acquire(&service, "native-1", "native", incumbent.clone()).await;

    let error = service
        .create_with(create("xterm-2", "xterm"), || {
            Err(ViewerOwnershipError::new(
                ViewerOwnershipErrorCode::MechanicsFailed,
                "xterm validation failed",
            ))
        })
        .await
        .unwrap_err();

    assert_eq!(error.code(), ViewerOwnershipErrorCode::MechanicsFailed);
    assert_eq!(lease(&database).await, current);
    assert!(incumbent.reasons().is_empty());
    assert_session_live(&database).await;
}

#[tokio::test]
async fn replacement_detaches_only_the_old_viewer_and_late_release_is_safe() {
    let database = fixture().await;
    let service = ViewerOwnershipService::new(database.clone());
    let old_mechanics = Arc::new(Mechanics::default());
    let old = acquire(&service, "native-1", "native", old_mechanics.clone()).await;
    let new_mechanics = Arc::new(Mechanics::default());
    let new = acquire(&service, "xterm-2", "xterm", new_mechanics.clone()).await;

    assert_eq!(old_mechanics.reasons(), vec![ViewerDetachReason::Replaced]);
    assert!(new_mechanics.reasons().is_empty());
    assert_eq!(lease(&database).await, new);

    let late = service
        .delete(DeleteViewerLease {
            agent_run_id: RUN_ID.into(),
            viewer_id: old.viewer_id,
            generation: old.generation,
        })
        .await
        .unwrap();
    assert!(late.is_none());
    assert_eq!(lease(&database).await, new);

    let released = service
        .delete(DeleteViewerLease {
            agent_run_id: RUN_ID.into(),
            viewer_id: new.viewer_id.clone(),
            generation: new.generation.clone(),
        })
        .await
        .unwrap();
    assert_eq!(released, Some(new));
    assert_eq!(new_mechanics.reasons(), vec![ViewerDetachReason::Released]);
    assert!(viewer_lease::Entity::find_by_id(RUN_ID)
        .one(&database)
        .await
        .unwrap()
        .is_none());
    assert_session_live(&database).await;
}

#[tokio::test]
async fn renewal_requires_the_exact_current_unexpired_generation() {
    let database = fixture().await;
    let service = ViewerOwnershipService::with_ttl(database.clone(), Duration::from_secs(60));
    let model = acquire(
        &service,
        "native-1",
        "native",
        Arc::new(Mechanics::default()),
    )
    .await;

    let renewed = service
        .update(UpdateViewerLease {
            agent_run_id: RUN_ID.into(),
            viewer_id: model.viewer_id.clone(),
            generation: model.generation.clone(),
        })
        .await
        .unwrap();
    assert!(renewed.expires_at > model.expires_at);

    let mut expired: viewer_lease::ActiveModel = renewed.clone().into();
    expired.expires_at = Set("2000-01-01T00:00:00.000000Z".into());
    expired.update(&database).await.unwrap();
    let error = service
        .update(UpdateViewerLease {
            agent_run_id: RUN_ID.into(),
            viewer_id: renewed.viewer_id,
            generation: renewed.generation,
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), ViewerOwnershipErrorCode::LeaseNotOwned);

    let replacement = acquire(&service, "xterm-2", "xterm", Arc::new(Mechanics::default())).await;
    assert_eq!(lease(&database).await, replacement);
    assert_session_live(&database).await;
}

#[tokio::test]
async fn periodic_stale_expiry_keeps_a_renewed_viewer_and_retires_only_the_lapsed_lease() {
    let database = fixture().await;
    insert_second_run(&database).await;
    let service = ViewerOwnershipService::with_ttl(database.clone(), Duration::from_secs(60));
    let healthy = Arc::new(Mechanics::default());
    let renewed = acquire(&service, "native-healthy", "native", healthy.clone()).await;
    let lapsed_mechanics = Arc::new(Mechanics::default());
    let lapsed = service
        .create_with(
            CreateViewerLease {
                agent_run_id: OTHER_RUN_ID.into(),
                viewer_id: "xterm-lapsed".into(),
                transport: "xterm".into(),
            },
            || Ok(lapsed_mechanics.clone()),
        )
        .await
        .unwrap();
    let forced = "2000-01-01T00:00:00.000000Z";
    let mut expired: viewer_lease::ActiveModel = lapsed.clone().into();
    expired.expires_at = Set(forced.into());
    expired.update(&database).await.unwrap();

    assert_eq!(service.expire_stale().await.unwrap(), 1);

    assert_eq!(lease(&database).await, renewed);
    assert!(healthy.reasons().is_empty());
    assert_eq!(
        lapsed_mechanics.reasons(),
        vec![ViewerDetachReason::Released]
    );
    // The renewed owner still holds durable ownership after the sweep.
    service
        .update(UpdateViewerLease {
            agent_run_id: RUN_ID.into(),
            viewer_id: renewed.viewer_id.clone(),
            generation: renewed.generation.clone(),
        })
        .await
        .unwrap();
    // The lapsed lease survives as durable history but owns nothing.
    let retired = viewer_lease::Entity::find_by_id(OTHER_RUN_ID)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert!(retired.expires_at.as_str() > forced);
    let error = service
        .update(UpdateViewerLease {
            agent_run_id: OTHER_RUN_ID.into(),
            viewer_id: lapsed.viewer_id,
            generation: lapsed.generation,
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), ViewerOwnershipErrorCode::LeaseNotOwned);
    assert_session_live(&database).await;
}

#[tokio::test]
async fn repeated_stale_expiry_never_takes_ownership_from_a_healthy_viewer() {
    let database = fixture().await;
    let service = ViewerOwnershipService::with_ttl(database.clone(), Duration::from_secs(60));
    let mechanics = Arc::new(Mechanics::default());
    let current = acquire(&service, "native-1", "native", mechanics.clone()).await;

    for _ in 0..3 {
        assert_eq!(service.expire_stale().await.unwrap(), 0);
    }

    assert_eq!(lease(&database).await, current);
    assert!(mechanics.reasons().is_empty());
    assert_session_live(&database).await;
}

#[tokio::test]
async fn startup_and_shutdown_expiry_still_retires_every_lease() {
    let database = fixture().await;
    let service = ViewerOwnershipService::with_ttl(database.clone(), Duration::from_secs(60));
    let mechanics = Arc::new(Mechanics::default());
    acquire(&service, "native-1", "native", mechanics.clone()).await;

    assert_eq!(service.expire_all().await.unwrap(), 1);

    assert_eq!(mechanics.reasons(), vec![ViewerDetachReason::Released]);
    let retired = lease(&database).await;
    let error = service
        .update(UpdateViewerLease {
            agent_run_id: RUN_ID.into(),
            viewer_id: retired.viewer_id,
            generation: retired.generation,
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), ViewerOwnershipErrorCode::LeaseNotOwned);
    assert_session_live(&database).await;
}

#[tokio::test]
async fn native_and_xterm_acquisitions_leave_exactly_one_interactive_owner() {
    let database = fixture().await;
    let service = ViewerOwnershipService::new(database.clone());
    let native = Arc::new(Mechanics::default());
    let xterm = Arc::new(Mechanics::default());
    service
        .stage_prepared(&create("native-racer", "native"), native.clone())
        .unwrap();
    service
        .stage_prepared(&create("xterm-racer", "xterm"), xterm.clone())
        .unwrap();

    let native_service = service.clone();
    let xterm_service = service.clone();
    let (native_result, xterm_result) = tokio::join!(
        native_service.create(create("native-racer", "native")),
        xterm_service.create(create("xterm-racer", "xterm")),
    );
    let native_model = native_result.unwrap();
    let xterm_model = xterm_result.unwrap();
    let current = lease(&database).await;
    assert!(current == native_model || current == xterm_model);

    let native_detached = native.reasons() == vec![ViewerDetachReason::Replaced];
    let xterm_detached = xterm.reasons() == vec![ViewerDetachReason::Replaced];
    assert_ne!(native_detached, xterm_detached);
    assert_eq!(
        viewer_lease::Entity::find()
            .all(&database)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_session_live(&database).await;
}

#[tokio::test]
async fn graphql_keeps_generated_writes_private_and_exposes_restricted_model_crud() {
    let sdl = ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
        .await
        .unwrap();
    assert!(sdl.contains("agentRunViewerLeases(filters:"));
    assert!(sdl.contains(
        "create_viewer_lease(agent_run_id: String!, viewer_id: String!, transport: String!): AgentRunViewerLeases!"
    ));
    assert!(sdl.contains(
        "update_viewer_lease(agent_run_id: String!, viewer_id: String!, generation: String!): AgentRunViewerLeases!"
    ));
    assert!(sdl.contains(
        "delete_viewer_lease(agent_run_id: String!, viewer_id: String!, generation: String!): AgentRunViewerLeases"
    ));
    for forbidden in [
        "agentRunViewerLeasesCreate",
        "agentRunViewerLeasesUpdate",
        "agentRunViewerLeasesDelete",
        "create_viewer_lease(agent_run_id: String!, viewer_id: String!, transport: String!, generation:",
        "create_viewer_lease(agent_run_id: String!, viewer_id: String!, transport: String!, acquired_at:",
        "create_viewer_lease(agent_run_id: String!, viewer_id: String!, transport: String!, expires_at:",
    ] {
        assert!(!sdl.contains(forbidden), "unsafe Viewer Lease field: {forbidden}");
    }
}

#[tokio::test]
async fn graphql_restricted_views_preserve_ownership_and_nullable_release() {
    let database = fixture().await;
    let service = ViewerOwnershipService::new(database.clone());
    let mechanics = Arc::new(Mechanics::default());
    service
        .stage_prepared(&create("graphql-native", "native"), mechanics.clone())
        .unwrap();
    let mut context = BuilderContext::default();
    ticketry_terminal::terminal::persistence::column_policy::apply(&mut context);
    let context = Box::leak(Box::new(context));
    let mut builder = Builder::new(context, database.clone());
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);
    let builder = ticketry_entities::work_management::register_entity_modules(builder);
    let builder = ticketry_terminal::terminal::persistence::register_graphql(builder);
    let builder = ticketry_terminal::terminal::viewer_lease::register_graphql(builder);
    let schema = builder
        .schema_builder()
        .data(database.clone())
        .data(service.clone())
        .finish()
        .unwrap();
    let response = schema
        .execute(viewer_request(
            "CreateViewerLease",
            serde_json::json!({
                "agentRunId": RUN_ID,
                "viewerId": "graphql-native",
                "transport": "native"
            }),
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let body = serde_json::to_value(response).unwrap();
    assert_eq!(body["data"]["viewer_lease"]["agent_run_id"], RUN_ID);
    assert_eq!(body["data"]["viewer_lease"]["viewer_id"], "graphql-native");
    let generation = body["data"]["viewer_lease"]["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    let acquired_expiry = body["data"]["viewer_lease"]["expires_at"]
        .as_str()
        .unwrap()
        .to_owned();

    let rejected = schema
        .execute(viewer_request(
            "UpdateViewerLease",
            serde_json::json!({
                "agentRunId": RUN_ID,
                "viewerId": "graphql-native",
                "generation": "replaced-generation"
            }),
        ))
        .await;
    let rejected = serde_json::to_value(rejected).unwrap();
    assert_eq!(
        rejected["errors"][0]["extensions"]["code"],
        "viewer_lease_not_owned"
    );

    let renewed = schema
        .execute(viewer_request(
            "UpdateViewerLease",
            serde_json::json!({
                "agentRunId": RUN_ID,
                "viewerId": "graphql-native",
                "generation": generation
            }),
        ))
        .await;
    assert!(renewed.errors.is_empty(), "{:?}", renewed.errors);
    let renewed = serde_json::to_value(renewed).unwrap();
    assert!(
        renewed["data"]["viewer_lease"]["expires_at"]
            .as_str()
            .unwrap()
            > acquired_expiry.as_str()
    );

    let late_release = schema
        .execute(viewer_request(
            "DeleteViewerLease",
            serde_json::json!({
                "agentRunId": RUN_ID,
                "viewerId": "graphql-native",
                "generation": "replaced-generation"
            }),
        ))
        .await;
    assert!(late_release.errors.is_empty(), "{:?}", late_release.errors);
    let late_release = serde_json::to_value(late_release).unwrap();
    assert!(late_release["data"]["viewer_lease"].is_null());
    assert!(viewer_lease::Entity::find_by_id(RUN_ID)
        .one(&database)
        .await
        .unwrap()
        .is_some());

    let released = schema
        .execute(viewer_request(
            "DeleteViewerLease",
            serde_json::json!({
                "agentRunId": RUN_ID,
                "viewerId": "graphql-native",
                "generation": generation
            }),
        ))
        .await;
    assert!(released.errors.is_empty(), "{:?}", released.errors);
    let released = serde_json::to_value(released).unwrap();
    assert_eq!(released["data"]["viewer_lease"]["generation"], generation);
    assert_eq!(mechanics.reasons(), vec![ViewerDetachReason::Released]);

    let repeated = schema
        .execute(viewer_request(
            "DeleteViewerLease",
            serde_json::json!({
                "agentRunId": RUN_ID,
                "viewerId": "graphql-native",
                "generation": generation
            }),
        ))
        .await;
    assert!(repeated.errors.is_empty(), "{:?}", repeated.errors);
    assert!(serde_json::to_value(repeated).unwrap()["data"]["viewer_lease"].is_null());

    let unauthorized_mechanics = Arc::new(Mechanics::default());
    let unauthorized = CreateViewerLease {
        agent_run_id: "missing-run".into(),
        viewer_id: "graphql-unauthorized".into(),
        transport: "native".into(),
    };
    service
        .stage_prepared(&unauthorized, unauthorized_mechanics.clone())
        .unwrap();
    let unauthorized = schema
        .execute(viewer_request(
            "CreateViewerLease",
            serde_json::json!({
                "agentRunId": "missing-run",
                "viewerId": "graphql-unauthorized",
                "transport": "native"
            }),
        ))
        .await;
    let unauthorized = serde_json::to_value(unauthorized).unwrap();
    assert_eq!(
        unauthorized["errors"][0]["extensions"]["code"],
        "agent_run_not_found"
    );
    assert_eq!(
        unauthorized_mechanics.reasons(),
        vec![ViewerDetachReason::AcquisitionFailed]
    );
}

fn viewer_request(operation: &str, variables: serde_json::Value) -> Request {
    Request::new(include_str!(
        "../../src/features/agents/terminal/operations/viewerLeases.graphql"
    ))
    .operation_name(operation)
    .variables(Variables::from_json(variables))
}

async fn acquire(
    service: &ViewerOwnershipService,
    viewer_id: &str,
    transport: &str,
    mechanics: Arc<Mechanics>,
) -> viewer_lease::Model {
    service
        .create_with(create(viewer_id, transport), || Ok(mechanics))
        .await
        .unwrap()
}

fn create(viewer_id: &str, transport: &str) -> CreateViewerLease {
    CreateViewerLease {
        agent_run_id: RUN_ID.into(),
        viewer_id: viewer_id.into(),
        transport: transport.into(),
    }
}

async fn lease(database: &DatabaseConnection) -> viewer_lease::Model {
    viewer_lease::Entity::find_by_id(RUN_ID)
        .one(database)
        .await
        .unwrap()
        .unwrap()
}

async fn assert_session_live(database: &DatabaseConnection) {
    let terminal = session::Entity::find_by_id(RUN_ID)
        .one(database)
        .await
        .unwrap()
        .unwrap();
    assert!(terminal.terminated_at.is_none());
    assert!(!terminal.runtime_cleanup_pending);
}

async fn insert_second_run(database: &DatabaseConnection) {
    let namespace = ticketry_terminal::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO agent_runs
                (id, issue_id, agent, status, started_at, scope)
                VALUES ('{OTHER_RUN_ID}', 'issue-2', 'codex', 'running',
                        '2026-08-19T00:00:00Z', 'task');
            INSERT INTO agent_terminal_sessions
                (agent_run_id, tmux_session_name, task_id, module_id, project_id,
                 created_at, scope, runtime_cleanup_pending, runtime_namespace,
                 output_sequence)
                VALUES ('{OTHER_RUN_ID}', 'pt-run-viewer-ownership-2', 'task-2', 'module-1',
                        'project-1', '2026-08-19T00:00:00Z', 'task', 0,
                        '{namespace}', 0);
            "#
        ))
        .await
        .unwrap();
}

async fn fixture() -> DatabaseConnection {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    let namespace = ticketry_terminal::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_unprepared(&format!(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE agent_runs (
                id varchar PRIMARY KEY,
                issue_id varchar NOT NULL,
                ticket_seq integer,
                agent varchar NOT NULL,
                model varchar,
                reasoning varchar,
                status varchar NOT NULL,
                started_at varchar NOT NULL,
                ended_at varchar,
                exit_code integer,
                error text,
                cwd varchar,
                provider_session_id varchar,
                lifecycle_state varchar,
                lifecycle_updated_at varchar,
                design_dir varchar,
                resumed_from varchar,
                scope varchar NOT NULL,
                launch_state varchar,
                launch_model varchar
            );
            CREATE TABLE worktracker_project (id varchar PRIMARY KEY);
            CREATE TABLE agent_terminal_sessions (
                agent_run_id varchar PRIMARY KEY REFERENCES agent_runs(id),
                tmux_session_name varchar NOT NULL,
                task_id varchar NOT NULL,
                module_id varchar NOT NULL,
                project_id varchar NOT NULL,
                created_at varchar NOT NULL,
                terminated_at varchar,
                scope varchar NOT NULL,
                doc_rel_path varchar,
                runtime_cleanup_pending bool NOT NULL,
                runtime_namespace varchar,
                output_identity varchar,
                output_sequence bigint NOT NULL,
                last_output_at varchar,
                agent varchar
            );
            CREATE TABLE agent_run_viewer_leases (
                agent_run_id varchar PRIMARY KEY REFERENCES agent_runs(id),
                viewer_id varchar NOT NULL,
                transport varchar NOT NULL,
                generation varchar NOT NULL,
                acquired_at varchar NOT NULL,
                expires_at varchar NOT NULL
            );
            INSERT INTO agent_runs
                (id, issue_id, agent, status, started_at, scope)
                VALUES ('{RUN_ID}', 'issue-1', 'codex', 'running',
                        '2026-08-19T00:00:00Z', 'task');
            INSERT INTO worktracker_project (id) VALUES ('project-1');
            INSERT INTO agent_terminal_sessions
                (agent_run_id, tmux_session_name, task_id, module_id, project_id,
                 created_at, scope, runtime_cleanup_pending, runtime_namespace,
                 output_sequence)
                VALUES ('{RUN_ID}', 'pt-run-viewer-ownership', 'task-1', 'module-1',
                        'project-1', '2026-08-19T00:00:00Z', 'task', 0,
                        '{namespace}', 0);
            "#
        ))
        .await
        .unwrap();
    database
}
