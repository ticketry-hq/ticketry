//! The first line on every socket connection, read before rmcp sees a byte.
//!
//! ```text
//! {"ticketry_mcp_auth":1,"mode":"run","agent_run_id":"<id>","authorization":"Bearer <token>"}
//! {"ticketry_mcp_auth":1,"mode":"global"}
//! ```
//!
//! The listener answers with exactly one line, `{"ticketry_mcp_auth":1,"ok":true}`
//! on acceptance or `{"ticketry_mcp_auth":1,"ok":false,"error":..,"reason":..}`
//! before closing on refusal, and only then hands the stream to the JSON-RPC
//! decoder. A missing, oversized, late, or malformed envelope never falls back
//! to the global mode: that mode has to be claimed in so many words.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use ticketry_runs::{AuthorizationFailure, RunAuthority};

pub const HANDSHAKE_VERSION: u64 = 1;
const MAX_ENVELOPE_BYTES: u64 = 8 * 1024;
const ENVELOPE_DEADLINE: Duration = Duration::from_secs(5);

/// What a connection was admitted as. Tool dispatch re-authorizes every call
/// from this, never from a principal cached at handshake time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ConnectionAuthorization {
    /// Local tooling without a run: normal tools, no run control.
    Global,
    /// A provider bridge speaking for one run with its bearer credential.
    Run { authorization: String },
}

impl ConnectionAuthorization {
    pub(super) fn bearer(&self) -> Option<&str> {
        match self {
            Self::Global => None,
            Self::Run { authorization } => Some(authorization),
        }
    }
}

#[derive(Deserialize)]
struct Envelope {
    ticketry_mcp_auth: u64,
    mode: String,
    #[serde(default)]
    agent_run_id: Option<String>,
    #[serde(default)]
    authorization: Option<String>,
}

fn refusal(error: &str, reason: &str) -> AuthorizationFailure {
    AuthorizationFailure(json!({"ok": false, "error": error, "reason": reason}))
}

/// Read and validate the envelope, then write the single-line verdict.
pub(super) async fn authenticate<R, W>(
    reader: &mut R,
    writer: &mut W,
    authority: &RunAuthority,
) -> Result<ConnectionAuthorization, AuthorizationFailure>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let verdict = admit(reader, authority).await;
    let mut reply = match &verdict {
        Ok(_) => json!({"ticketry_mcp_auth": HANDSHAKE_VERSION, "ok": true}),
        Err(AuthorizationFailure(failure)) => failure.clone(),
    };
    if let Value::Object(fields) = &mut reply {
        fields.insert("ticketry_mcp_auth".to_owned(), json!(HANDSHAKE_VERSION));
    }
    let mut line = serde_json::to_vec(&reply).unwrap_or_default();
    line.push(b'\n');
    if writer.write_all(&line).await.is_err() || writer.flush().await.is_err() {
        return Err(refusal("handshake_failed", "handshake_write_failed"));
    }
    verdict
}

async fn admit<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    authority: &RunAuthority,
) -> Result<ConnectionAuthorization, AuthorizationFailure> {
    let mut line = Vec::new();
    let read = tokio::time::timeout(
        ENVELOPE_DEADLINE,
        reader
            .take(MAX_ENVELOPE_BYTES + 1)
            .read_until(b'\n', &mut line),
    )
    .await
    .map_err(|_| refusal("handshake_failed", "handshake_timeout"))?
    .map_err(|_| refusal("handshake_failed", "handshake_read_failed"))?;
    if read == 0 {
        return Err(refusal("handshake_failed", "handshake_missing"));
    }
    if line.last() != Some(&b'\n') {
        return Err(refusal("handshake_failed", "handshake_too_large"));
    }
    let envelope: Envelope = serde_json::from_slice(&line)
        .map_err(|_| refusal("handshake_failed", "handshake_malformed"))?;
    if envelope.ticketry_mcp_auth != HANDSHAKE_VERSION {
        return Err(refusal("handshake_failed", "handshake_unsupported_version"));
    }
    match envelope.mode.as_str() {
        "global" => Ok(ConnectionAuthorization::Global),
        "run" => {
            let agent_run_id = envelope
                .agent_run_id
                .filter(|id| !id.is_empty())
                .ok_or_else(|| refusal("caller_run_unbound", "handshake_run_missing"))?;
            authority
                .authenticate_claimed_run(envelope.authorization.as_deref(), &agent_run_id)
                .await?;
            Ok(ConnectionAuthorization::Run {
                authorization: envelope.authorization.unwrap_or_default(),
            })
        }
        _ => Err(refusal("handshake_failed", "handshake_mode_unknown")),
    }
}
