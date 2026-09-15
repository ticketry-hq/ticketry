use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::BufReader;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::cli::McpInvocation;
use crate::protocol::{
    id_key, jsonrpc_error, replay_compatible, response_key, Outstanding, Phase, Session,
};
use crate::transport::{
    connect_authenticated, read_buffered_frame, read_stdin, write_json, write_raw, write_socket,
    Frame, Input, CONNECT_TIMEOUT,
};

const INITIAL_BACKOFF: Duration = Duration::from_millis(100);
const MAX_BACKOFF: Duration = Duration::from_secs(1);
const CREDENTIAL_BACKOFF: Duration = Duration::from_secs(5 * 60);

type ConnectResult = Result<(OwnedReadHalf, OwnedWriteHalf), String>;
type ConnectTask = Pin<Box<dyn Future<Output = ConnectResult>>>;

pub async fn run(invocation: McpInvocation) -> io::Result<()> {
    let authorization = std::env::var("TICKETRY_MCP_AUTHORIZATION").map_err(|_| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "TICKETRY_MCP_AUTHORIZATION is required",
        )
    })?;
    if authorization.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "TICKETRY_MCP_AUTHORIZATION is required",
        ));
    }

    let socket_path = invocation.data_dir.join("mcp.sock");
    let (input_tx, mut input_rx) = mpsc::channel(32);
    tokio::spawn(read_stdin(input_tx));
    let mut output = tokio::io::stdout();
    let mut reader = None;
    let mut frame = Frame::default();
    let mut writer = None;
    let mut phase = Phase::AwaitInitialize;
    let mut session: Option<Session> = None;
    let mut outstanding = HashMap::<String, Outstanding>::new();
    let mut generation = 0_u64;
    let mut replay_id = String::new();
    let mut backoff = INITIAL_BACKOFF;
    let mut retry_at = Instant::now();
    let mut connect: Option<ConnectTask> = None;
    let mut unavailable_reason = "service_unavailable".to_owned();
    let mut pending_initialize: Option<(Value, Vec<u8>, Instant)> = None;

    loop {
        if reader.is_none() && connect.is_none() && Instant::now() >= retry_at {
            connect = Some(Box::pin(connect_authenticated(
                socket_path.clone(),
                invocation.agent_run_id.clone(),
                authorization.clone(),
            )));
        }

        tokio::select! {
            input = input_rx.recv() => match input.unwrap_or(Input::Eof) {
                Input::Eof => return Ok(()),
                Input::Failed(error) => return Err(error),
                Input::Malformed => write_json(&mut output, &jsonrpc_error(Value::Null, -32700, "Parse error", "invalid_json")).await?,
                Input::TooLarge => write_json(&mut output, &jsonrpc_error(Value::Null, -32600, "Message exceeds limit", "message_too_large")).await?,
                Input::Message(message, raw)
                    if writer.is_none()
                        && session.is_none()
                        && pending_initialize.is_none()
                        && message.get("method").and_then(Value::as_str) == Some("initialize")
                        && message.get("id").and_then(id_key).is_some() =>
                {
                    pending_initialize = Some((message, raw, Instant::now() + CONNECT_TIMEOUT));
                }
                Input::Message(message, raw) => {
                    if handle_provider_message(
                        message,
                        raw,
                        &mut writer,
                        phase,
                        generation,
                        &unavailable_reason,
                        &mut outstanding,
                        &mut session,
                        &mut output,
                    ).await? {
                        disconnect(&mut reader, &mut writer, &mut outstanding, &mut output).await?;
                        phase = Phase::AwaitInitialize;
                        retry_at = Instant::now() + backoff;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    } else if phase == Phase::AwaitInitialized
                        && session.as_ref().and_then(|value| value.initialized.as_ref()).is_some()
                    {
                        phase = Phase::Ready;
                    }
                }
            },
            result = poll_connect(&mut connect), if connect.is_some() => {
                connect = None;
                match result {
                    Ok((socket_reader, mut socket_writer)) => {
                        generation = generation.wrapping_add(1);
                        unavailable_reason = "service_unavailable".to_owned();
                        if let Some(active) = &session {
                            replay_id = format!("ticketry-private-replay-{}-{generation}", std::process::id());
                            let mut replay = active.initialize.clone();
                            replay["id"] = Value::String(replay_id.clone());
                            if write_socket(&mut socket_writer, &serde_json::to_vec(&replay).unwrap()).await.is_err() {
                                retry_at = Instant::now() + backoff;
                                backoff = (backoff * 2).min(MAX_BACKOFF);
                                continue;
                            }
                            phase = Phase::Replaying;
                        } else {
                            phase = Phase::AwaitInitialize;
                        }
                        reader = Some(BufReader::new(socket_reader));
                        frame = Frame::default();
                        writer = Some(socket_writer);
                        if let Some((message, raw, _)) = pending_initialize.take() {
                            if handle_provider_message(
                                message,
                                raw,
                                &mut writer,
                                phase,
                                generation,
                                &unavailable_reason,
                                &mut outstanding,
                                &mut session,
                                &mut output,
                            ).await? {
                                disconnect(&mut reader, &mut writer, &mut outstanding, &mut output).await?;
                                phase = Phase::AwaitInitialize;
                                retry_at = Instant::now() + backoff;
                                backoff = (backoff * 2).min(MAX_BACKOFF);
                            }
                        }
                    }
                    Err(reason) => {
                        let retry_delay = match reason.as_str() {
                            "authorization_missing" | "authorization_malformed"
                            | "authorization_invalid" | "authorization_expired"
                            | "authorization_foreign_run" | "caller_run_unknown" => CREDENTIAL_BACKOFF,
                            _ => backoff,
                        };
                        unavailable_reason = reason;
                        retry_at = Instant::now() + retry_delay;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                }
            },
            socket_message = read_socket(&mut reader, &mut frame), if reader.is_some() => {
                match socket_message {
                    Ok(Some(raw)) => match serde_json::from_slice::<Value>(&raw) {
                        Ok(message) if phase == Phase::Replaying
                            && message.get("id") == Some(&Value::String(replay_id.clone())) =>
                        {
                            if replay_compatible(session.as_ref().expect("replay session"), &message) {
                                backoff = INITIAL_BACKOFF;
                                if let Some(initialized) = session.as_ref().and_then(|value| value.initialized.as_ref()) {
                                    if write_socket(writer.as_mut().expect("connected writer"), initialized).await.is_err() {
                                        disconnect(&mut reader, &mut writer, &mut outstanding, &mut output).await?;
                                        retry_at = Instant::now() + backoff;
                                        continue;
                                    }
                                    phase = Phase::Ready;
                                } else {
                                    phase = Phase::AwaitInitialized;
                                }
                            } else {
                                phase = Phase::Incompatible;
                                unavailable_reason = "session_incompatible".to_owned();
                            }
                        }
                        Ok(message) => {
                            if let Some(key) = response_key(&message) {
                                let key = format!("{generation}:{key}");
                                if let Some(pending) = outstanding.remove(&key) {
                                    if let Outstanding::Initialize(initialize) = pending {
                                        if let Some(result) = message.get("result") {
                                            session = Some(Session {
                                                initialize,
                                                initialized: None,
                                                protocol: result.get("protocolVersion").cloned().unwrap_or(Value::Null),
                                                capabilities: result.get("capabilities").cloned().unwrap_or_else(|| json!({})),
                                            });
                                            phase = Phase::AwaitInitialized;
                                            backoff = INITIAL_BACKOFF;
                                        } else if session.is_none() {
                                            phase = Phase::AwaitInitialize;
                                        }
                                    }
                                    write_raw(&mut output, &raw).await?;
                                } else if message.get("method").is_some() {
                                    write_raw(&mut output, &raw).await?;
                                }
                            } else {
                                write_raw(&mut output, &raw).await?;
                            }
                        }
                        Err(_) => {
                            disconnect(&mut reader, &mut writer, &mut outstanding, &mut output).await?;
                            phase = Phase::AwaitInitialize;
                            retry_at = Instant::now() + backoff;
                            backoff = (backoff * 2).min(MAX_BACKOFF);
                        }
                    },
                    Ok(None) | Err(_) => {
                        disconnect(&mut reader, &mut writer, &mut outstanding, &mut output).await?;
                        phase = Phase::AwaitInitialize;
                        retry_at = Instant::now() + backoff;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                }
            },
            _ = pending_timeout(&pending_initialize), if pending_initialize.is_some() => {
                let (message, _, _) = pending_initialize.take().expect("guarded pending initialize");
                write_json(
                    &mut output,
                    &jsonrpc_error(
                        message.get("id").cloned().unwrap_or(Value::Null),
                        -32001,
                        "Ticketry MCP is unavailable",
                        &unavailable_reason,
                    ),
                ).await?;
            },
            _ = tokio::time::sleep_until(retry_at), if reader.is_none() && connect.is_none() => {}
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_provider_message(
    message: Value,
    raw: Vec<u8>,
    writer: &mut Option<OwnedWriteHalf>,
    phase: Phase,
    generation: u64,
    unavailable_reason: &str,
    outstanding: &mut HashMap<String, Outstanding>,
    session: &mut Option<Session>,
    output: &mut tokio::io::Stdout,
) -> io::Result<bool> {
    let method = message.get("method").and_then(Value::as_str);
    let id = message.get("id").cloned();

    if method.is_none() {
        if phase == Phase::Ready {
            return Ok(write_socket(writer.as_mut().expect("ready writer"), &raw)
                .await
                .is_err());
        }
        return Ok(false);
    }
    if id.is_none() {
        if method == Some("notifications/initialized")
            && session.is_some()
            && matches!(
                phase,
                Phase::AwaitInitialize | Phase::AwaitInitialized | Phase::Replaying
            )
        {
            session.as_mut().expect("initialized session").initialized = Some(raw);
            if phase == Phase::AwaitInitialized
                && write_socket(
                    writer.as_mut().expect("initialized writer"),
                    session
                        .as_ref()
                        .and_then(|value| value.initialized.as_ref())
                        .expect("stored initialized notification"),
                )
                .await
                .is_err()
            {
                return Ok(true);
            }
        } else if phase == Phase::Ready
            && write_socket(writer.as_mut().expect("ready writer"), &raw)
                .await
                .is_err()
        {
            return Ok(true);
        }
        return Ok(false);
    }

    let id = id.unwrap();
    let Some(key) = id_key(&id) else {
        write_json(
            output,
            &jsonrpc_error(
                Value::Null,
                -32600,
                "Invalid request ID",
                "invalid_request_id",
            ),
        )
        .await?;
        return Ok(false);
    };
    if method == Some("initialize") && phase != Phase::AwaitInitialize {
        write_json(
            output,
            &jsonrpc_error(
                id,
                -32600,
                "Initialize already completed",
                "already_initialized",
            ),
        )
        .await?;
        return Ok(false);
    }
    if phase == Phase::Incompatible {
        write_json(
            output,
            &jsonrpc_error(
                id,
                -32001,
                "Ticketry MCP session is incompatible",
                "session_incompatible",
            ),
        )
        .await?;
        return Ok(false);
    }
    let allowed =
        (phase == Phase::AwaitInitialize && method == Some("initialize")) || phase == Phase::Ready;
    if !allowed || writer.is_none() {
        write_json(
            output,
            &jsonrpc_error(
                id,
                -32001,
                "Ticketry MCP is unavailable",
                unavailable_reason,
            ),
        )
        .await?;
        return Ok(false);
    }
    let generation_key = format!("{generation}:{key}");
    if outstanding.contains_key(&generation_key) {
        write_json(
            output,
            &jsonrpc_error(
                id,
                -32600,
                "Request ID is already outstanding",
                "duplicate_request_id",
            ),
        )
        .await?;
        return Ok(false);
    }
    let pending = if method == Some("initialize") {
        Outstanding::Initialize(message)
    } else {
        Outstanding::Ordinary
    };
    outstanding.insert(generation_key, pending);
    Ok(write_socket(writer.as_mut().unwrap(), &raw).await.is_err())
}

async fn disconnect(
    reader: &mut Option<BufReader<OwnedReadHalf>>,
    writer: &mut Option<OwnedWriteHalf>,
    outstanding: &mut HashMap<String, Outstanding>,
    output: &mut tokio::io::Stdout,
) -> io::Result<()> {
    *reader = None;
    *writer = None;
    for key in outstanding.keys().cloned().collect::<Vec<_>>() {
        outstanding.remove(&key);
        if let Some(id) = key
            .split_once(':')
            .and_then(|(_, id)| serde_json::from_str(id).ok())
        {
            write_json(
                output,
                &jsonrpc_error(
                    id,
                    -32001,
                    "Connection lost; execution outcome may be unknown",
                    "execution_outcome_unknown",
                ),
            )
            .await?;
        }
    }
    Ok(())
}

async fn poll_connect(connect: &mut Option<ConnectTask>) -> ConnectResult {
    match connect {
        Some(connect) => connect.await,
        None => std::future::pending().await,
    }
}

async fn read_socket(
    reader: &mut Option<BufReader<OwnedReadHalf>>,
    frame: &mut Frame,
) -> io::Result<Option<Vec<u8>>> {
    match reader {
        Some(reader) => read_buffered_frame(reader, frame).await,
        None => std::future::pending().await,
    }
}

async fn pending_timeout(pending: &Option<(Value, Vec<u8>, Instant)>) {
    match pending {
        Some((_, _, deadline)) => tokio::time::sleep_until(*deadline).await,
        None => std::future::pending().await,
    }
}
