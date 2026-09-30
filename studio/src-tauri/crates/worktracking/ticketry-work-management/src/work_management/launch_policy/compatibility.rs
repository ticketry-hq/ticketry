use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use super::{mark_delivered, record, CallerScope, LaunchPolicyRequest, LaunchPolicyResolver};

/// Resolve, durably record, and submit one desktop interactive request.
pub async fn submit_interactive(
    database: &DatabaseConnection,
    backend_base_url: &str,
    api_key: &str,
    task_id: String,
) -> Result<Value, String> {
    let resolver = LaunchPolicyResolver::new(database.clone());
    let decision = resolver
        .resolve(LaunchPolicyRequest {
            task_id,
            destination_state_id: None,
            provider_override: None,
            caller_scope: CallerScope::Interactive,
            idempotency_key: uuid::Uuid::new_v4().simple().to_string(),
            handoff: false,
        })
        .await
        .map_err(|error| error.code().to_owned())?;
    let decision = record(database, &decision)
        .await
        .map_err(|error| error.code().to_owned())?;
    let response = reqwest::Client::new()
        .post(format!(
            "{}/execution/launch-policy-effects",
            backend_base_url.trim_end_matches('/')
        ))
        .header("x-api-key", api_key)
        .json(&decision)
        .send()
        .await
        .map_err(|_| "launch_effect_unavailable".to_owned())?;
    let status = response.status();
    let body = response.json::<Value>().await.unwrap_or_else(
        |_| json!({"detail": "launch_effect_invalid_response", "status": status.as_u16()}),
    );
    if !status.is_success() {
        return Err(body
            .get("code")
            .or_else(|| body.get("detail"))
            .and_then(Value::as_str)
            .unwrap_or("launch_effect_failed")
            .to_owned());
    }
    mark_delivered(database, &decision.decision_id)
        .await
        .map_err(|error| error.code().to_owned())?;
    Ok(body)
}
