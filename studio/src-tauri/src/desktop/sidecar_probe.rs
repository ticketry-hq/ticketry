//! Packaging smoke check: prove the ready sidecar enforces its credential and
//! its single trusted origin before the smoke run reports success.
//!
//! This speaks HTTP directly over a loopback socket so the check cannot be
//! satisfied by a client library's redirect, proxy, or retry behaviour.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub(crate) fn verify_packaged_backend(
    port: u16,
    credential: &str,
    origin: &str,
) -> Result<(), String> {
    let valid = sidecar_http_status(port, credential, origin)?;
    if valid != 200 {
        return Err(format!("authenticated request returned HTTP {valid}"));
    }
    let rejected = sidecar_http_status(port, "wrong-credential", origin)?;
    if rejected != 401 {
        return Err(format!(
            "invalid credential returned HTTP {rejected}, expected 401"
        ));
    }
    let origin_rejected = sidecar_http_status(port, credential, "http://untrusted.invalid")?;
    if origin_rejected != 403 {
        return Err(format!(
            "untrusted origin returned HTTP {origin_rejected}, expected 403"
        ));
    }
    Ok(())
}

fn sidecar_http_status(port: u16, credential: &str, origin: &str) -> Result<u16, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .map_err(|error| format!("could not connect to ready backend: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(
            format!(
                "GET /api/work-tracker/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nx-api-key: {credential}\r\nOrigin: {origin}\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .map_err(|error| format!("could not make authenticated request: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("could not read backend response: {error}"))?;
    response
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "backend returned no HTTP status".to_owned())?
        .parse::<u16>()
        .map_err(|error| format!("backend returned an invalid HTTP status: {error}"))
}
