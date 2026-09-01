use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex, RwLock};

use futures_util::{Stream, StreamExt};
use tauri::ipc::Channel;

use crate::endpoint::{error_response, service_unavailable_response};
use crate::GraphQlEndpoint;

const MAX_ACTIVE_SUBSCRIPTIONS: usize = 256;

pub type GraphQlSubscriptionStream = Pin<Box<dyn Stream<Item = String> + Send>>;

#[taurpc::procedures]
pub trait TransportApi {
    async fn graphql_execute(request_json: String) -> String;
    async fn graphql_subscribe(
        subscription_id: String,
        request_json: String,
        on_event: Channel<String>,
    ) -> String;
    async fn graphql_unsubscribe(subscription_id: String) -> bool;
}

#[derive(Clone, Default)]
pub struct TransportApiImpl {
    endpoint: Arc<RwLock<Option<GraphQlEndpoint>>>,
    subscriptions: Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>>,
}

impl TransportApiImpl {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn install_endpoint(&self, endpoint: GraphQlEndpoint) -> Result<(), String> {
        let mut installed = self
            .endpoint
            .write()
            .map_err(|_| "the GraphQL endpoint lock is poisoned".to_owned())?;
        *installed = Some(endpoint);
        Ok(())
    }

    fn installed_endpoint(&self) -> Option<GraphQlEndpoint> {
        self.endpoint
            .read()
            .ok()
            .and_then(|endpoint| endpoint.clone())
    }

    /// Open the framed stream shared by Tauri channels and the browser adapter.
    pub fn graphql_subscription_stream(
        &self,
        request_json: &str,
    ) -> Result<GraphQlSubscriptionStream, String> {
        let endpoint = self
            .installed_endpoint()
            .ok_or_else(service_unavailable_response)?;
        let stream = endpoint.execute_stream_json(request_json)?;
        Ok(Box::pin(
            stream
                .map(|response_json| subscription_event(&response_json))
                .chain(futures_util::stream::once(async {
                    r#"{"type":"complete"}"#.to_owned()
                })),
        ))
    }
}

/// Whether an identifier is safe on every supported subscription carrier.
pub fn valid_subscription_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn subscription_event(response_json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(response_json) {
        Ok(payload) => serde_json::json!({ "type": "next", "payload": payload }).to_string(),
        Err(error) => serde_json::json!({
            "type": "next",
            "payload": {
                "data": null,
                "errors": [{
                    "message": "The subscription response could not be decoded.",
                    "extensions": { "code": "internal", "detail": error.to_string() }
                }]
            }
        })
        .to_string(),
    }
}

#[taurpc::resolvers]
impl TransportApi for TransportApiImpl {
    async fn graphql_execute(self, request_json: String) -> String {
        match self.installed_endpoint() {
            Some(endpoint) => endpoint.execute_json(&request_json).await,
            None => service_unavailable_response(),
        }
    }

    async fn graphql_subscribe(
        self,
        subscription_id: String,
        request_json: String,
        on_event: Channel<String>,
    ) -> String {
        if !valid_subscription_id(&subscription_id) {
            return error_response(
                "The subscription id is invalid.",
                "bad_request",
                "use 1-128 ASCII letters, digits, hyphens, or underscores",
            );
        }
        let stream = match self.graphql_subscription_stream(&request_json) {
            Ok(stream) => stream,
            Err(response) => return response,
        };

        let mut registry = match self.subscriptions.lock() {
            Ok(registry) => registry,
            Err(_) => {
                return error_response(
                    "The subscription registry is unavailable.",
                    "internal",
                    "the subscription registry lock is poisoned",
                )
            }
        };
        if registry.contains_key(&subscription_id) {
            return error_response(
                "The subscription id is already active.",
                "bad_request",
                &subscription_id,
            );
        }
        if registry.len() >= MAX_ACTIVE_SUBSCRIPTIONS {
            return error_response(
                "The application has too many active subscriptions.",
                "resource_exhausted",
                "unsubscribe an existing stream before opening another",
            );
        }

        // Prevent a short stream from completing before its abort handle has
        // been inserted into the registry.
        let (start_sender, start_receiver) = tokio::sync::oneshot::channel();
        let subscriptions = self.subscriptions.clone();
        let task_id = subscription_id.clone();
        let task = tokio::spawn(async move {
            if start_receiver.await.is_err() {
                return;
            }
            let mut stream = Box::pin(stream);
            while let Some(event) = stream.next().await {
                if on_event.send(event).is_err() {
                    break;
                }
            }
            if let Ok(mut subscriptions) = subscriptions.lock() {
                subscriptions.remove(&task_id);
            }
        });
        registry.insert(subscription_id, task.abort_handle());
        drop(registry);
        if start_sender.send(()).is_err() {
            task.abort();
            return error_response(
                "The subscription could not start.",
                "internal",
                "the subscription task ended before start",
            );
        }
        r#"{"type":"accepted"}"#.to_owned()
    }

    async fn graphql_unsubscribe(self, subscription_id: String) -> bool {
        let handle = self
            .subscriptions
            .lock()
            .ok()
            .and_then(|mut subscriptions| subscriptions.remove(&subscription_id));
        if let Some(handle) = handle {
            handle.abort();
            true
        } else {
            false
        }
    }
}
