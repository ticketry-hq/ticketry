use std::time::Duration;

use async_graphql::dynamic::{
    Field, FieldFuture, FieldValue, Object, Schema, Subscription, SubscriptionField,
    SubscriptionFieldFuture, TypeRef,
};
use futures_util::StreamExt;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_graphql::{GraphQlEndpoint, TransportApi, TransportApiImpl};

fn test_schema() -> Schema {
    let query = Object::new("Query").field(Field::new(
        "ping",
        TypeRef::named_nn(TypeRef::STRING),
        |_| FieldFuture::new(async { Ok(Some(FieldValue::value("pong"))) }),
    ));
    let subscription = Subscription::new("Subscription")
        .field(SubscriptionField::new(
            "ticks",
            TypeRef::named_nn(TypeRef::INT),
            |_| {
                SubscriptionFieldFuture::new(async {
                    let first = futures_util::stream::once(async { Ok(FieldValue::value(1)) });
                    let rest = futures_util::stream::pending();
                    Ok(first.chain(rest))
                })
            },
        ))
        .field(SubscriptionField::new(
            "finiteTicks",
            TypeRef::named_nn(TypeRef::INT),
            |_| {
                SubscriptionFieldFuture::new(async {
                    Ok(futures_util::stream::once(async {
                        Ok(FieldValue::value(2))
                    }))
                })
            },
        ));

    Schema::build("Query", None, Some("Subscription"))
        .register(query)
        .register(subscription)
        .finish()
        .expect("build the transport test schema")
}

fn installed_api() -> TransportApiImpl {
    let api = TransportApiImpl::new();
    api.install_endpoint(GraphQlEndpoint::new(test_schema()))
        .expect("install the endpoint");
    api
}

fn capture_channel() -> (
    Channel<String>,
    tokio::sync::mpsc::UnboundedReceiver<String>,
) {
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let channel = Channel::new(move |message: InvokeResponseBody| {
        let InvokeResponseBody::Json(encoded) = message else {
            panic!("subscription events must cross as JSON");
        };
        let event: String = serde_json::from_str(&encoded).expect("decode the channel payload");
        sender.send(event).expect("record the subscription event");
        Ok(())
    });
    (channel, receiver)
}

async fn next_event(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
) -> serde_json::Value {
    let event = tokio::time::timeout(Duration::from_secs(5), receiver.recv())
        .await
        .expect("receive a subscription event within five seconds")
        .expect("the subscription channel stays open");
    serde_json::from_str(&event).expect("decode the event envelope")
}

#[tokio::test]
async fn unary_requests_return_graphql_response_envelopes() {
    let response: serde_json::Value = serde_json::from_str(
        &installed_api()
            .graphql_execute(
                serde_json::json!({
                    "query": "query Ping { ping }",
                    "operationName": "Ping",
                    "variables": null
                })
                .to_string(),
            )
            .await,
    )
    .expect("decode the response");
    assert_eq!(response["data"]["ping"], "pong");
}

#[tokio::test]
async fn malformed_empty_and_oversized_requests_are_bounded() {
    let api = installed_api();
    let malformed: serde_json::Value =
        serde_json::from_str(&api.clone().graphql_execute("{".to_owned()).await)
            .expect("decode malformed response");
    assert_eq!(malformed["errors"][0]["extensions"]["code"], "bad_request");

    let empty: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(r#"{"query":"   "}"#.to_owned())
            .await,
    )
    .expect("decode empty response");
    assert_eq!(empty["errors"][0]["extensions"]["code"], "bad_request");

    let oversized = "x".repeat(1024 * 1024 + 1);
    let too_large: serde_json::Value = serde_json::from_str(&api.graphql_execute(oversized).await)
        .expect("decode oversized response");
    assert_eq!(
        too_large["errors"][0]["extensions"]["code"],
        "payload_too_large"
    );
}

#[tokio::test]
async fn calls_before_initialization_return_a_structured_unavailable_error() {
    let response: serde_json::Value = serde_json::from_str(
        &TransportApiImpl::new()
            .graphql_execute(r#"{"query":"query { ping }"}"#.to_owned())
            .await,
    )
    .expect("decode unavailable response");

    assert_eq!(response["data"], serde_json::Value::Null);
    assert_eq!(
        response["errors"][0]["extensions"]["code"],
        "service_unavailable"
    );
}

#[tokio::test]
async fn subscriptions_stream_and_teardown_without_stale_registry_entries() {
    let api = installed_api();
    let (channel, mut receiver) = capture_channel();
    let request = serde_json::json!({
        "query": "subscription Ticks { ticks }",
        "operationName": "Ticks",
        "variables": null
    })
    .to_string();

    assert_eq!(
        api.clone()
            .graphql_subscribe("sub-1".to_owned(), request.clone(), channel)
            .await,
        r#"{"type":"accepted"}"#
    );
    let first = next_event(&mut receiver).await;
    assert_eq!(first["payload"]["data"]["ticks"], 1);

    let (duplicate_channel, _duplicate_receiver) = capture_channel();
    let duplicate: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_subscribe("sub-1".to_owned(), request, duplicate_channel)
            .await,
    )
    .expect("decode duplicate response");
    assert_eq!(duplicate["errors"][0]["extensions"]["code"], "bad_request");

    assert!(api.clone().graphql_unsubscribe("sub-1".to_owned()).await);
    assert!(!api.graphql_unsubscribe("sub-1".to_owned()).await);
}

#[tokio::test]
async fn shared_subscription_stream_uses_transport_frames_and_completes() {
    let api = installed_api();
    let request = serde_json::json!({
        "query": "subscription FiniteTicks { finiteTicks }",
        "operationName": "FiniteTicks",
        "variables": null
    })
    .to_string();
    let mut stream = api
        .graphql_subscription_stream(&request)
        .expect("open the shared subscription stream");

    let next: serde_json::Value = serde_json::from_str(
        &stream
            .next()
            .await
            .expect("receive the GraphQL result frame"),
    )
    .expect("decode the next frame");
    assert_eq!(next["type"], "next");
    assert_eq!(next["payload"]["data"]["finiteTicks"], 2);

    let complete: serde_json::Value =
        serde_json::from_str(&stream.next().await.expect("receive the completion frame"))
            .expect("decode the completion frame");
    assert_eq!(complete["type"], "complete");
    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn subscription_ids_are_restricted() {
    let api = installed_api();
    let (channel, _receiver) = capture_channel();
    let response: serde_json::Value = serde_json::from_str(
        &api.graphql_subscribe(
            "contains spaces".to_owned(),
            r#"{"query":"subscription { ticks }"}"#.to_owned(),
            channel,
        )
        .await,
    )
    .expect("decode invalid id response");
    assert_eq!(response["errors"][0]["extensions"]["code"], "bad_request");
}
