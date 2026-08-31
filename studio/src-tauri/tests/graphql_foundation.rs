use sea_orm::Database;
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::graphql_foundation::{
    initialize, initialize_and_install, FoundationInitializationErrorCode,
};

fn request(query: &str, variables: serde_json::Value) -> String {
    serde_json::json!({
        "query": query,
        "variables": variables,
    })
    .to_string()
}

#[tokio::test]
async fn migration_probes_are_only_composed_into_the_isolated_foundation_schema() {
    let foundation_database = Database::connect("sqlite::memory:")
        .await
        .expect("open foundation schema database");
    let probe_schema = ticketry_graphql_schema::query_root::foundation_schema(
        foundation_database,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("build isolated foundation schema")
    .sdl();

    let foundation_database = Database::connect("sqlite::memory:")
        .await
        .expect("open product foundation database");
    let worktracker_database = Database::connect("sqlite::memory:")
        .await
        .expect("open product state database");
    let product_schema = ticketry_graphql_schema::query_root::foundation_schema(
        foundation_database,
        Some(worktracker_database),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("build product schema")
    .sdl();

    assert!(probe_schema.contains("migrationProbes"));
    assert!(probe_schema.contains("migrationProbesCreateOne"));
    for operation in ["CreateBatch", "Update", "Delete"] {
        assert!(
            !probe_schema.contains(&format!("migrationProbes{operation}")),
            "isolated schema exposed unused migrationProbes{operation}"
        );
    }
    assert!(!probe_schema.contains("MigrationProbesUpdateInput"));
    assert!(!probe_schema.contains("worktrackerIssuetypeCreateOne"));
    assert!(!product_schema.contains("migrationProbes"));
    assert!(product_schema.contains("worktrackerIssuetypeCreateOne"));
}

#[tokio::test]
async fn restart_reopens_the_foundation_database() {
    let directory = tempfile::tempdir().expect("create foundation test directory");
    let database_path = directory.path().join("rust-core.sqlite3");
    let runtime = initialize(&database_path)
        .await
        .expect("initialize foundation database");

    let mutation: serde_json::Value = serde_json::from_str(
        &runtime
            .endpoint()
            .execute_json(&request(
                "mutation CreateProbe($data: MigrationProbesInsertInput!) { migrationProbesCreateOne(data: $data) { id value } }",
                serde_json::json!({ "data": { "id": 1, "value": "reopened" } }),
            ))
            .await,
    )
    .expect("decode mutation response");
    assert_eq!(mutation["data"]["migrationProbesCreateOne"]["id"], 1);
    drop(runtime);

    let reopened = initialize(&database_path)
        .await
        .expect("reopen foundation database");
    let query: serde_json::Value = serde_json::from_str(
        &reopened
            .endpoint()
            .execute_json(&request(
                "query FoundationProbe { migrationProbes { nodes { id value } } }",
                serde_json::Value::Null,
            ))
            .await,
    )
    .expect("decode query response");

    assert_eq!(query["data"]["migrationProbes"]["nodes"][0]["id"], 1);
    assert_eq!(
        query["data"]["migrationProbes"]["nodes"][0]["value"],
        "reopened"
    );
}

#[tokio::test]
async fn initialization_failure_is_structured_and_installs_no_partial_endpoint() {
    let directory = tempfile::tempdir().expect("create foundation test directory");
    let non_directory = directory.path().join("not-a-directory");
    std::fs::write(&non_directory, b"blocks database parent")
        .expect("create a non-directory parent");
    let database_path = non_directory.join("rust-core.sqlite3");
    let api = TransportApiImpl::new();

    let error = match initialize_and_install(&database_path, &api).await {
        Ok(()) => panic!("initialization must reject an invalid database parent"),
        Err(error) => error,
    };

    assert_eq!(
        error.code,
        FoundationInitializationErrorCode::DatabaseDirectory
    );
    assert_eq!(
        serde_json::to_value(&error).expect("serialize structured error")["code"],
        "database_directory"
    );
    assert!(!database_path.exists());

    let unavailable: serde_json::Value = serde_json::from_str(
        &api.graphql_execute(request(
            "query { migrationProbes { nodes { id } } }",
            serde_json::Value::Null,
        ))
        .await,
    )
    .expect("decode unavailable response");
    assert_eq!(
        unavailable["errors"][0]["extensions"]["code"],
        "service_unavailable"
    );
}

#[tokio::test]
async fn generated_query_is_reachable_through_the_taurpc_transport() {
    let directory = tempfile::tempdir().expect("create foundation test directory");
    let api = TransportApiImpl::new();
    initialize_and_install(&directory.path().join("rust-core.sqlite3"), &api)
        .await
        .expect("install foundation endpoint");

    let response: serde_json::Value = serde_json::from_str(
        &api.graphql_execute(request(
            "query FoundationProbe { migrationProbes { nodes { id value } } }",
            serde_json::Value::Null,
        ))
        .await,
    )
    .expect("decode transport response");

    assert_eq!(
        response["data"]["migrationProbes"]["nodes"],
        serde_json::json!([])
    );
}

#[tokio::test]
async fn generated_mutation_is_reachable_through_the_taurpc_transport() {
    let directory = tempfile::tempdir().expect("create foundation test directory");
    let api = TransportApiImpl::new();
    initialize_and_install(&directory.path().join("rust-core.sqlite3"), &api)
        .await
        .expect("install foundation endpoint");

    let response: serde_json::Value = serde_json::from_str(
        &api.graphql_execute(request(
            "mutation CreateMigrationProbe($data: MigrationProbesInsertInput!) { migrationProbesCreateOne(data: $data) { id value } }",
            serde_json::json!({ "data": { "id": 1, "value": "generated" } }),
        ))
        .await,
    )
    .expect("decode command response");

    assert_eq!(response["data"]["migrationProbesCreateOne"]["id"], 1);
    assert_eq!(
        response["data"]["migrationProbesCreateOne"]["value"],
        "generated"
    );
}
