use async_graphql::dynamic::{Field, FieldFuture, FieldValue, Object, Schema, TypeRef};
use reqwest::{Client, StatusCode};
use tauri_graphql::{GraphQlEndpoint, TransportApiImpl};
use ticketry_planner::{PlannerFrontendOrigin, PlannerService};

fn installed_api() -> TransportApiImpl {
    let query = Object::new("Query").field(Field::new(
        "ready",
        TypeRef::named_nn(TypeRef::BOOLEAN),
        |_| FieldFuture::new(async { Ok(Some(FieldValue::value(true))) }),
    ));
    let schema = Schema::build("Query", None, None)
        .register(query)
        .finish()
        .unwrap();
    let api = TransportApiImpl::new();
    api.install_endpoint(GraphQlEndpoint::new(schema)).unwrap();
    api
}

#[tokio::test]
async fn requires_an_installed_schema_and_reports_the_requested_bind_address() {
    let result = PlannerService::start(TransportApiImpl::new(), 0, None, |_| {}).await;
    assert!(result
        .err()
        .unwrap()
        .contains("authoritative GraphQL endpoint"));
    let occupied = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = occupied.local_addr().unwrap().port();
    let result = PlannerService::start(installed_api(), port, None, |_| {}).await;
    assert!(result
        .err()
        .unwrap()
        .contains(&format!("could not bind 127.0.0.1:{port}")));
}

#[tokio::test]
async fn admits_the_planner_ui_and_rejects_untrusted_requests_then_releases_the_port() {
    let runtime = PlannerService::start(
        installed_api(),
        0,
        Some(PlannerFrontendOrigin::parse("http://127.0.0.1:5176").unwrap()),
        |error| panic!("{error}"),
    )
    .await
    .unwrap();
    let endpoint = runtime.endpoint().clone();
    let client = Client::new();
    let request = serde_json::json!({"query": "{ ready }"});
    let authorized = || {
        client
            .post(&endpoint.graphql_url)
            .bearer_auth(&endpoint.bearer_token)
            .json(&request)
    };
    assert_eq!(
        client
            .post(&endpoint.graphql_url)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        authorized()
            .header("Origin", "https://untrusted.example")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        authorized()
            .header("Host", "untrusted.example")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        client
            .post(&endpoint.graphql_url)
            .bearer_auth("expired")
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let response = authorized()
        .header("Origin", "tauri://localhost")
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        "tauri://localhost"
    );
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap(),
        serde_json::json!({"data": {"ready": true}})
    );
    let preflight = client
        .request(reqwest::Method::OPTIONS, &endpoint.graphql_url)
        .header("Origin", "http://127.0.0.1:5176")
        .header("Access-Control-Request-Method", "POST")
        .header(
            "Access-Control-Request-Headers",
            "authorization,content-type",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        preflight.headers()["access-control-allow-origin"],
        "http://127.0.0.1:5176"
    );
    for origin in [
        "http://127.0.0.1:5176",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ] {
        let response = authorized().header("Origin", origin).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["access-control-allow-origin"], origin);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            serde_json::json!({"data": {"ready": true}})
        );
    }
    for origin in [
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5176",
        "https://untrusted.example",
    ] {
        let response = authorized().header("Origin", origin).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!response
            .headers()
            .contains_key("access-control-allow-origin"));
        let response = client
            .request(reqwest::Method::OPTIONS, &endpoint.graphql_url)
            .header("Origin", origin)
            .header("Access-Control-Request-Method", "POST")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!response
            .headers()
            .contains_key("access-control-allow-origin"));
    }
    assert!(!format!("{endpoint:?}").contains(&endpoint.bearer_token));

    let port = reqwest::Url::parse(&endpoint.graphql_url)
        .unwrap()
        .port()
        .unwrap();
    runtime.shutdown().await.unwrap();
    assert!(authorized().send().await.is_err());
    let _rebound = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
}

#[tokio::test]
async fn dropping_the_owner_stops_its_listener() {
    let runtime = PlannerService::start(installed_api(), 0, None, |error| panic!("{error}"))
        .await
        .unwrap();
    let port = reqwest::Url::parse(&runtime.endpoint().graphql_url)
        .unwrap()
        .port()
        .unwrap();
    drop(runtime);
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if tokio::net::TcpListener::bind(("127.0.0.1", port))
                .await
                .is_ok()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn clean_shutdown_finishes_an_admitted_request_before_releasing_ownership() {
    use std::sync::Arc;
    use tokio::sync::Notify;
    let started = Arc::new(Notify::new());
    let finish = Arc::new(Notify::new());
    let query =
        Object::new("Query").field(Field::new("slow", TypeRef::named_nn(TypeRef::BOOLEAN), {
            let started = started.clone();
            let finish = finish.clone();
            move |_| {
                let started = started.clone();
                let finish = finish.clone();
                FieldFuture::new(async move {
                    started.notify_one();
                    finish.notified().await;
                    Ok(Some(FieldValue::value(true)))
                })
            }
        }));
    let api = TransportApiImpl::new();
    api.install_endpoint(GraphQlEndpoint::new(
        Schema::build("Query", None, None)
            .register(query)
            .finish()
            .unwrap(),
    ))
    .unwrap();
    let runtime = PlannerService::start(api, 0, None, |error| panic!("{error}"))
        .await
        .unwrap();
    let endpoint = runtime.endpoint().clone();
    let request = tokio::spawn(async move {
        Client::new()
            .post(endpoint.graphql_url)
            .bearer_auth(endpoint.bearer_token)
            .json(&serde_json::json!({"query": "{ slow }"}))
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap()
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    let mut shutdown = tokio::spawn(runtime.shutdown());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut shutdown)
            .await
            .is_err()
    );
    finish.notify_one();
    assert_eq!(
        request.await.unwrap(),
        serde_json::json!({"data": {"slow": true}})
    );
    shutdown.await.unwrap().unwrap();
}

#[tokio::test]
async fn rejects_an_unauthorized_request_before_waiting_for_its_body() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let runtime = PlannerService::start(installed_api(), 0, None, |error| panic!("{error}"))
        .await
        .unwrap();
    let url = reqwest::Url::parse(&runtime.endpoint().graphql_url).unwrap();
    let address = format!("127.0.0.1:{}", url.port().unwrap());
    let mut connection = tokio::net::TcpStream::connect(&address).await.unwrap();
    connection.write_all(format!("POST /graphql HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    let mut response = [0; 1024];
    let count = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        connection.read(&mut response),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(std::str::from_utf8(&response[..count])
        .unwrap()
        .starts_with("HTTP/1.1 403"));
    drop(connection);
    runtime.shutdown().await.unwrap();
}

#[tokio::test]
async fn no_frontend_configuration_does_not_admit_a_default_browser_origin() {
    let runtime = PlannerService::start(installed_api(), 0, None, |_| {})
        .await
        .unwrap();
    let endpoint = runtime.endpoint();
    let response = Client::new()
        .post(&endpoint.graphql_url)
        .header("Origin", "http://127.0.0.1:5174")
        .bearer_auth(&endpoint.bearer_token)
        .json(&serde_json::json!({"query": "{ ready }"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    runtime.shutdown().await.unwrap();
}
