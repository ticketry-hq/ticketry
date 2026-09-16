use std::io;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_HANDSHAKE_BYTES: usize = 8 * 1024;

pub enum Input {
    Message(Value, Vec<u8>),
    Malformed,
    TooLarge,
    Eof,
    Failed(io::Error),
}

pub async fn connect_authenticated(
    path: PathBuf,
    agent_run_id: String,
    authorization: String,
) -> Result<(OwnedReadHalf, OwnedWriteHalf), String> {
    tokio::time::timeout(CONNECT_TIMEOUT, async move {
        let mut stream = UnixStream::connect(path)
            .await
            .map_err(|_| "service_unavailable".to_owned())?;
        let envelope = serde_json::to_vec(&json!({
            "ticketry_mcp_auth": 1,
            "mode": "run",
            "agent_run_id": agent_run_id,
            "authorization": authorization,
        }))
        .map_err(|_| "handshake_malformed".to_owned())?;
        if envelope.len() > MAX_HANDSHAKE_BYTES {
            return Err("handshake_too_large".to_owned());
        }
        write_socket(&mut stream, &envelope)
            .await
            .map_err(|_| "handshake_write_failed".to_owned())?;
        let mut stream = BufReader::new(stream);
        let verdict = read_frame(&mut stream)
            .await
            .map_err(|_| "handshake_read_failed".to_owned())?
            .ok_or_else(|| "handshake_missing".to_owned())?;
        let verdict: Value =
            serde_json::from_slice(&verdict).map_err(|_| "handshake_malformed".to_owned())?;
        if verdict.get("ok") != Some(&Value::Bool(true)) {
            return Err(verdict
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("handshake_rejected")
                .to_owned());
        }
        Ok(stream.into_inner().into_split())
    })
    .await
    .map_err(|_| "service_unavailable".to_owned())?
}

pub async fn read_stdin(sender: mpsc::Sender<Input>) {
    let mut input = BufReader::new(tokio::io::stdin());
    loop {
        let event = match read_frame(&mut input).await {
            Ok(Some(raw)) => match serde_json::from_slice(&raw) {
                Ok(value) => Input::Message(value, raw),
                Err(_) => Input::Malformed,
            },
            Ok(None) => Input::Eof,
            Err(error) if error.kind() == io::ErrorKind::InvalidData => Input::TooLarge,
            Err(error) => Input::Failed(error),
        };
        let done = matches!(event, Input::Eof | Input::Failed(_));
        if sender.send(event).await.is_err() || done {
            return;
        }
    }
}

pub async fn read_frame(reader: &mut (impl AsyncBufRead + Unpin)) -> io::Result<Option<Vec<u8>>> {
    read_buffered_frame(reader, &mut Frame::default()).await
}

#[derive(Default)]
pub struct Frame {
    bytes: Vec<u8>,
    oversized: bool,
}

// The caller retains partial input when another tokio::select! branch wins.
pub async fn read_buffered_frame(
    reader: &mut (impl AsyncBufRead + Unpin),
    frame: &mut Frame,
) -> io::Result<Option<Vec<u8>>> {
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if std::mem::take(&mut frame.oversized) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "message exceeds limit",
                ));
            }
            return if frame.bytes.is_empty() {
                Ok(None)
            } else {
                Ok(Some(std::mem::take(&mut frame.bytes)))
            };
        }
        let end = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        let complete = available[..end].ends_with(b"\n");
        if frame.oversized || frame.bytes.len() + end > MAX_MESSAGE_BYTES {
            frame.bytes.clear();
            frame.oversized = !complete;
            reader.consume(end);
            if !complete {
                continue;
            }
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "message exceeds limit",
            ));
        }
        frame.bytes.extend_from_slice(&available[..end]);
        reader.consume(end);
        if complete {
            frame.bytes.pop();
            if frame.bytes.last() == Some(&b'\r') {
                frame.bytes.pop();
            }
            return Ok(Some(std::mem::take(&mut frame.bytes)));
        }
    }
}

pub async fn write_socket(writer: &mut (impl AsyncWrite + Unpin), raw: &[u8]) -> io::Result<()> {
    writer.write_all(raw).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await
}

pub async fn write_raw(output: &mut tokio::io::Stdout, raw: &[u8]) -> io::Result<()> {
    write_socket(output, raw).await
}

pub async fn write_json(output: &mut tokio::io::Stdout, value: &Value) -> io::Result<()> {
    write_raw(
        output,
        &serde_json::to_vec(value).expect("JSON-RPC value serializes"),
    )
    .await
}
