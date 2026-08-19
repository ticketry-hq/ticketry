//! The Design Document contract the composed schema actually publishes.
//!
//! Generated Seaography reads are the default: listing, filtering, ordering,
//! and pagination all come from the framework rather than a mirrored DTO or a
//! pass-through repository. The two authority columns and the whole generated
//! mutation bundle must be absent.

use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_and_install;
use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::{TransportApi, TransportApiImpl};

fn request(query: &str, variables: serde_json::Value) -> String {
    serde_json::json!({ "query": query, "variables": variables }).to_string()
}

/// A state.db carrying the adopted `design_documents` shape.
async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().expect("create Documents fixture directory");
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open fixture writer");
    writer
        .execute_unprepared(
            r#"
        PRAGMA journal_mode=WAL;
        CREATE TABLE design_documents (
            id VARCHAR NOT NULL,
            module_id VARCHAR NOT NULL,
            task_id VARCHAR NOT NULL,
            scope VARCHAR NOT NULL,
            root_dir VARCHAR NOT NULL,
            rel_path VARCHAR NOT NULL,
            discovered_by_run_id VARCHAR,
            created_at VARCHAR NOT NULL,
            updated_at VARCHAR NOT NULL,
            content_digest VARCHAR,
            PRIMARY KEY (id),
            CONSTRAINT uq_design_doc_path UNIQUE (root_dir, rel_path)
        );
        INSERT INTO design_documents VALUES
            ('d1', 'm1', 't1', 'task', '/modules/ticketry/spec/T755', 'SPEC.md',
             'run-1', '2026-01-01T00:00:00+00:00', '2026-01-02T00:00:00+00:00',
             'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4'),
            ('d2', 'm1', 't1', 'task', '/modules/ticketry/spec/T755', 'notes/Design.HTML',
             NULL, '2026-01-03T00:00:00+00:00', '2026-01-03T00:00:00+00:00', NULL),
            ('d3', 'm1', '00000000-0000-0000-0000-000000000000', 'plan',
             '/modules/ticketry/spec/planning--3f2a', 'Plan.md',
             NULL, '2026-01-04T00:00:00+00:00', '2026-01-04T00:00:00+00:00', NULL);
    "#,
        )
        .await
        .expect("create adopted Documents fixture");
    (directory, writer)
}

async fn install(directory: &tempfile::TempDir) -> TransportApiImpl {
    let api = TransportApiImpl::new();
    initialize_with_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &api,
    )
    .await
    .expect("install composed GraphQL endpoint");
    api
}

#[tokio::test]
async fn generated_reads_serve_filtering_ordering_and_pagination() {
    let (directory, _writer) = fixture().await;
    let api = install(&directory).await;

    let response: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(request(
                r#"query($task: String!) {
                  forTask: designDocuments(
                    filters: { taskId: { eq: $task } }
                    orderBy: { createdAt: ASC }
                  ) {
                    nodes { id relPath scope contentDigest }
                    paginationInfo { pages current }
                  }
                  firstOnly: designDocuments(
                    filters: { taskId: { eq: $task } }
                    orderBy: { createdAt: ASC }
                    pagination: { page: { limit: 1, page: 0 } }
                  ) {
                    nodes { id }
                    paginationInfo { pages }
                  }
                  scratch: designDocuments(filters: { scope: { eq: "plan" } }) {
                    nodes { id moduleId taskId }
                  }
                }"#,
                serde_json::json!({ "task": "t1" }),
            ))
            .await,
    )
    .expect("decode generated Documents read");

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"]["forTask"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["relPath"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["SPEC.md", "notes/Design.HTML"]
    );
    assert_eq!(
        response["data"]["forTask"]["nodes"][0]["contentDigest"],
        "a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4"
    );
    assert_eq!(
        response["data"]["forTask"]["nodes"][1]["contentDigest"],
        serde_json::Value::Null
    );
    assert_eq!(response["data"]["firstOnly"]["nodes"][0]["id"], "d1");
    assert_eq!(response["data"]["firstOnly"]["paginationInfo"]["pages"], 2);
    assert_eq!(response["data"]["scratch"]["nodes"][0]["id"], "d3");
    assert_eq!(
        response["data"]["scratch"]["nodes"][0]["taskId"],
        "00000000-0000-0000-0000-000000000000"
    );
}

#[tokio::test]
async fn the_absolute_root_and_run_provenance_are_not_in_the_public_contract() {
    let (directory, _writer) = fixture().await;
    let api = install(&directory).await;

    for field in ["rootDir", "discoveredByRunId"] {
        let response: serde_json::Value = serde_json::from_str(
            &api.clone()
                .graphql_execute(request(
                    &format!("query {{ designDocuments {{ nodes {{ id {field} }} }} }}"),
                    serde_json::Value::Null,
                ))
                .await,
        )
        .expect("decode rejected Documents read");
        assert!(
            response["errors"].is_array(),
            "{field} is queryable on the public contract"
        );
    }

    // The same columns are also unavailable as a filter, so a caller cannot
    // probe local paths by asking which roots match.
    let filtered: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(request(
                r#"query { designDocuments(filters: { rootDir: { eq: "/modules" } }) { nodes { id } } }"#,
                serde_json::Value::Null,
            ))
            .await,
    )
    .expect("decode rejected Documents filter");
    assert!(filtered["errors"].is_array());
}

#[tokio::test]
async fn generated_design_document_mutations_are_not_public() {
    let (directory, _writer) = fixture().await;
    let api = install(&directory).await;

    let response: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(request(
                "query { __schema { mutationType { fields { name } } } }",
                serde_json::Value::Null,
            ))
            .await,
    )
    .expect("decode mutation introspection");

    let fields = response["data"]["__schema"]["mutationType"]["fields"]
        .as_array()
        .expect("mutation fields")
        .iter()
        .map(|field| field["name"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
        let field = format!("designDocuments{operation}");
        assert!(
            !fields.contains(&field),
            "the unsafe generated bundle became public: {field}"
        );
    }
}
