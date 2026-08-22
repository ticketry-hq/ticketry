//! Confirming a started sidecar actually answers.
//!
//! A process that is running is not the same as a backend that serves, so
//! readiness is followed by a real request on the loopback port.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

pub(super) const MCP_RESPONSE_LIMIT_BYTES: usize = 64 * 1024;

pub(super) fn backend_health_probe_succeeds(port: u16, timeout: Duration) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
        return false;
    };
    if stream.set_read_timeout(Some(timeout)).is_err()
        || stream.set_write_timeout(Some(timeout)).is_err()
    {
        return false;
    }
    if stream
        .write_all(b"GET /api/healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && backend_health_response_is_healthy(&response)
}

pub(super) fn backend_health_response_is_healthy(response: &str) -> bool {
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    headers.starts_with("HTTP/1.1 200")
        && serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|payload| payload.get("ok").and_then(serde_json::Value::as_bool))
            == Some(true)
}

pub(super) fn mcp_initialize_succeeds(port: u16, deadline: Instant) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return false;
    }
    let Ok(mut stream) =
        TcpStream::connect_timeout(&address, remaining.min(Duration::from_millis(250)))
    else {
        return false;
    };
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero()
        || stream
            .set_write_timeout(Some(remaining.min(Duration::from_millis(250))))
            .is_err()
    {
        return false;
    }
    let payload = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"muxed-supervisor","version":"1"}}}"#;
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero()
            || stream
                .set_read_timeout(Some(remaining.min(Duration::from_millis(250))))
                .is_err()
        {
            return false;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                if response.len().saturating_add(count) > MCP_RESPONSE_LIMIT_BYTES {
                    return false;
                }
                response.extend_from_slice(&chunk[..count]);
                let text = String::from_utf8_lossy(&response);
                if text.contains("HTTP/1.1 200") && text.contains("\"name\":\"worktracker-agent\"")
                {
                    return true;
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break;
            }
            Err(_) => break,
        }
    }
    false
}
