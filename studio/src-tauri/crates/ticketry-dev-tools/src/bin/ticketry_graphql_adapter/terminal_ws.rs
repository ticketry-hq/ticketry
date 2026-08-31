//! Browser-development terminal WebSocket bridge.
//!
//! `/ws/terminal` is attach-only: the first text frame is an `init` frame
//! naming the agent run to attach and its terminal geometry, and spawning
//! stays a GraphQL launch responsibility. After init the socket carries
//! canonical terminal traffic — binary input frames in, binary output frames
//! out, JSON resize/scroll controls — over the transport-independent
//! `terminal_viewer` attachment boundary. Durable session safety comes from
//! `viewer_ownership` leases; a viewer ending never terminates tmux.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket};
use serde::{Deserialize, Serialize};

use ticketry_terminal::terminal::viewer::attachment::{
    TerminalAttachment, TerminalAttachmentError,
};
use ticketry_terminal::viewer_ownership::ViewerOwnershipService;

use super::viewer_session;

pub(crate) const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_GEOMETRY: u16 = 500;
pub(crate) const MAX_CONCURRENT_VIEWERS: usize = 64;

pub(crate) const CLOSE_NORMAL: u16 = 1000;
pub(crate) const CLOSE_UNACCEPTABLE_DATA: u16 = 1003;
pub(crate) const CLOSE_POLICY_VIOLATION: u16 = 1008;
pub(crate) const CLOSE_ATTACHMENT_FAILED: u16 = 1011;
pub(crate) const CLOSE_TOO_MANY_SESSIONS: u16 = 1013;
pub(crate) const CLOSE_INPUT_TOO_LARGE: u16 = 1009;
/// Session-count and pressure limits share 1013 ("try again later").
pub(crate) const CLOSE_PRESSURE: u16 = 1013;
pub(crate) const CLOSE_LEASE_LOST: u16 = 4009;

/// How one browser viewer session ended and what should be reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SessionClose {
    /// The transport disappeared before or during the session; nothing can be
    /// sent any more.
    TransportGone,
    /// A clean detach or expected terminal end.
    Normal(&'static str),
    Rejected(InitRejection),
    SessionNotFound,
    SessionEnded,
    LeaseRejected(String),
    AttachmentFailed(String),
    InputTooLarge,
    TooManySessions,
    /// The bounded output queue could not drain within its send timeout.
    OutputPressure,
    /// The bounded command queue stayed full past its acceptance timeout.
    InputPressure,
    LeaseLost,
}

impl SessionClose {
    pub(crate) fn close_code(&self) -> u16 {
        match self {
            Self::TransportGone | Self::Normal(_) => CLOSE_NORMAL,
            Self::Rejected(rejection) => rejection.close_code(),
            Self::SessionNotFound => CLOSE_POLICY_VIOLATION,
            Self::SessionEnded => CLOSE_POLICY_VIOLATION,
            Self::LeaseRejected(_) => CLOSE_POLICY_VIOLATION,
            Self::AttachmentFailed(_) => CLOSE_ATTACHMENT_FAILED,
            Self::InputTooLarge => CLOSE_INPUT_TOO_LARGE,
            Self::TooManySessions => CLOSE_TOO_MANY_SESSIONS,
            Self::OutputPressure | Self::InputPressure => CLOSE_PRESSURE,
            Self::LeaseLost => CLOSE_LEASE_LOST,
        }
    }

    fn message(&self) -> Option<String> {
        match self {
            Self::TransportGone => None,
            Self::Normal(reason) => Some((*reason).to_owned()),
            Self::Rejected(rejection) => Some(rejection.message().to_owned()),
            Self::SessionNotFound => Some("session_not_found".to_owned()),
            Self::SessionEnded => Some("session_ended".to_owned()),
            Self::LeaseRejected(error) => Some(format!("lease_rejected: {error}")),
            Self::AttachmentFailed(error) => Some(format!("attachment_failed: {error}")),
            Self::InputTooLarge => Some("input_too_large".to_owned()),
            Self::TooManySessions => Some("too_many_sessions".to_owned()),
            Self::OutputPressure => Some("terminal_output_pressure".to_owned()),
            Self::InputPressure => Some("terminal_input_pressure".to_owned()),
            Self::LeaseLost => Some("replaced_by_another_viewer".to_owned()),
        }
    }

    /// Every close that reaches a still-listening client must carry enough
    /// information for [`finish_socket`] to build an error frame and close
    /// reason. This is the seam the rejection path routes through.
    pub(crate) fn finished_close(&self) -> (u16, String) {
        let code = self.close_code();
        let message = self.message().unwrap_or_else(|| "detached".to_owned());
        (code, message)
    }
}

/// Why an `init` frame did not become an attachment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitRejection {
    Malformed,
    SpawnRejected,
    InvalidIdentity,
    InvalidGeometry,
}

impl InitRejection {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Malformed => "bad_init",
            Self::SpawnRejected => "spawn_not_supported",
            Self::InvalidIdentity => "invalid_agent_run_id",
            Self::InvalidGeometry => "invalid_geometry",
        }
    }

    /// Malformed first frames are unacceptable data (1003); well-formed but
    /// rejected inits are policy violations (1008).
    fn close_code(self) -> u16 {
        match self {
            Self::Malformed => CLOSE_UNACCEPTABLE_DATA,
            _ => CLOSE_POLICY_VIOLATION,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttachRequest {
    pub(crate) agent_run_id: String,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum InitEnvelope {
    #[serde(rename = "init")]
    Init(InitDiscriminant),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
enum InitDiscriminant {
    #[serde(rename = "attach")]
    Attach {
        agent_run_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "spawn")]
    Spawn {},
}

/// Parse the mandatory first frame. Only `mode:"attach"` becomes an
/// [`AttachRequest`]; every other well-formed init — notably `spawn` — is
/// rejected by name.
pub(crate) fn parse_init(raw: &str) -> Result<AttachRequest, InitRejection> {
    let Ok(envelope) = serde_json::from_str::<InitEnvelope>(raw) else {
        return Err(InitRejection::Malformed);
    };
    let InitEnvelope::Init(discriminant) = envelope;
    let InitDiscriminant::Attach {
        agent_run_id,
        cols,
        rows,
    } = discriminant
    else {
        return Err(InitRejection::SpawnRejected);
    };
    if !validate_run_id(&agent_run_id) {
        return Err(InitRejection::InvalidIdentity);
    }
    if !validate_geometry(cols, rows) {
        return Err(InitRejection::InvalidGeometry);
    }
    Ok(AttachRequest {
        agent_run_id,
        cols,
        rows,
    })
}

pub(crate) fn validate_run_id(run_id: &str) -> bool {
    !run_id.is_empty()
        && run_id.len() <= 128
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(crate) fn validate_geometry(cols: u16, rows: u16) -> bool {
    (1..=MAX_GEOMETRY).contains(&cols) && (1..=MAX_GEOMETRY).contains(&rows)
}

/// Classify one incoming frame during the init phase. Every `Err` here is a
/// [`SessionClose`] the caller must report through [`finish_socket`] — there
/// is no silent-drop path out of the init phase.
fn classify_init(
    frame: Option<Result<Message, axum::Error>>,
) -> Result<AttachRequest, SessionClose> {
    match frame {
        None | Some(Err(_)) => Err(SessionClose::TransportGone),
        Some(Ok(Message::Text(text))) => parse_init(&text).map_err(SessionClose::Rejected),
        Some(Ok(_)) => Err(SessionClose::Rejected(InitRejection::Malformed)),
    }
}

/// The documented pre-upgrade loopback boundary for `/ws/terminal`.
///
/// The Host header must name a loopback host (`127.0.0.1`, `localhost`, or
/// `[::1]`, with an optional port). If an Origin header is present it must be
/// an http/https URL whose host also passes that same check; a missing Origin
/// passes only after Host does. No wildcard CORS is offered.
pub(crate) fn loopback_gate(host: Option<&str>, origin: Option<&str>) -> Result<(), &'static str> {
    let Some(host) = host else {
        return Err("missing Host header");
    };
    if !authority_is_loopback(host) {
        return Err("Host is not loopback");
    }
    let Some(origin) = origin else {
        return Ok(());
    };
    if !origin_is_loopback_http(origin) {
        return Err("Origin is not a loopback http(s) URL");
    }
    Ok(())
}

const LOOPBACK_HOSTS: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

/// Strip an optional port from a Host/URL authority and require the bare
/// hostname to be exactly one of the loopback hosts.
fn authority_is_loopback(authority: &str) -> bool {
    if authority.is_empty() || authority.trim() != authority || authority.contains('@') {
        return false;
    }
    let bare = if let Some(bracketed) = authority.strip_prefix('[') {
        let Some(closing_bracket) = bracketed.find(']') else {
            return false;
        };
        let tail = &bracketed[closing_bracket + 1..];
        if !tail.is_empty() && !valid_explicit_port(tail.strip_prefix(':')) {
            return false;
        }
        &bracketed[..closing_bracket]
    } else if let Some((host, port)) = authority.rsplit_once(':') {
        if !valid_explicit_port(Some(port)) {
            return false;
        }
        host
    } else {
        authority
    };
    let lowercased = bare.to_ascii_lowercase();
    LOOPBACK_HOSTS.contains(&lowercased.as_str())
}

fn valid_explicit_port(port: Option<&str>) -> bool {
    port.is_some_and(|port| !port.is_empty() && port.parse::<u16>().is_ok())
}

fn origin_is_loopback_http(origin: &str) -> bool {
    let Ok(uri) = origin.parse::<http::Uri>() else {
        return false;
    };
    let Some(scheme) = uri.scheme_str() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    let origin_has_no_path_or_query = match uri.path_and_query() {
        None => true,
        Some(path) => path.as_str() == "/",
    };
    (scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https"))
        && origin_has_no_path_or_query
        && authority_is_loopback(authority.as_str())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ServerFrame {
    Ready {
        session_id: String,
        agent_run_id: String,
    },
    Error {
        message: String,
    },
}

impl ServerFrame {
    pub(crate) fn to_message(&self) -> Message {
        Message::Text(Utf8Bytes::from(
            serde_json::to_string(self).expect("server frames always serialize"),
        ))
    }
}

/// Process-wide state shared by every browser terminal socket.
#[derive(Clone)]
pub(crate) struct TerminalBridge {
    ownership: ViewerOwnershipService,
    sessions: Arc<AtomicUsize>,
}

impl TerminalBridge {
    pub(crate) fn new(ownership: ViewerOwnershipService) -> Self {
        Self {
            ownership,
            sessions: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub(crate) async fn accept(self: Arc<Self>, socket: WebSocket) {
        if self.sessions.fetch_add(1, Ordering::SeqCst) >= MAX_CONCURRENT_VIEWERS {
            self.sessions.fetch_sub(1, Ordering::SeqCst);
            self.finish(socket, SessionClose::TooManySessions).await;
            return;
        }
        let close = self.run(socket).await;
        self.sessions.fetch_sub(1, Ordering::SeqCst);
        eprintln!(
            "browser terminal session closed: code={} message={:?}",
            close.close_code(),
            close.message()
        );
    }

    async fn run(&self, mut socket: WebSocket) -> SessionClose {
        let request = loop {
            match classify_init(socket.recv().await) {
                Ok(request) => break request,
                // Every rejection — including spawn attempts and malformed
                // first frames — is reported to the client before returning.
                Err(SessionClose::TransportGone) => return SessionClose::TransportGone,
                Err(close) => return self.finish(socket, close).await,
            }
        };

        // Attachment spawns the transient tmux client through its PTY pair, so
        // it runs off the async runtime like every other blocking viewer call.
        let agent_run_id = request.agent_run_id.clone();
        let attached = match tokio::task::spawn_blocking(move || {
            TerminalAttachment::attach(&agent_run_id, request.cols, request.rows)
        })
        .await
        {
            Ok(attached) => attached,
            Err(error) => {
                return self
                    .finish(
                        socket,
                        SessionClose::AttachmentFailed(format!(
                            "terminal attachment task failed: {error}"
                        )),
                    )
                    .await;
            }
        };
        let attachment = match attached {
            Ok(attachment) => attachment,
            Err(TerminalAttachmentError::SessionNotFound { .. }) => {
                return self.finish(socket, SessionClose::SessionNotFound).await;
            }
            Err(TerminalAttachmentError::SessionEnded { .. }) => {
                return self.finish(socket, SessionClose::SessionEnded).await;
            }
            Err(error) => {
                return self
                    .finish(socket, SessionClose::AttachmentFailed(error.to_string()))
                    .await;
            }
        };

        viewer_session::start(
            self.ownership.clone(),
            request.agent_run_id,
            attachment,
            socket,
        )
        .await
    }

    async fn finish(&self, socket: WebSocket, close: SessionClose) -> SessionClose {
        finish_socket(socket, close).await
    }
}

/// Report a session ending to a client that may still be listening. Called
/// exactly once per socket, after every lease release and viewer detach.
pub(crate) async fn finish_socket(mut socket: WebSocket, close: SessionClose) -> SessionClose {
    let (code, reason) = close.finished_close();
    if code != CLOSE_NORMAL {
        let _ = socket
            .send(
                ServerFrame::Error {
                    message: reason.clone(),
                }
                .to_message(),
            )
            .await;
    }
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: Utf8Bytes::from(reason),
        })))
        .await;
    close
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_attach_frames_parse_into_attachment_requests() {
        let raw =
            r#"{"type":"init","mode":"attach","agent_run_id":"run-1_a","cols":120,"rows":40}"#;
        assert_eq!(
            parse_init(raw).expect("valid init"),
            AttachRequest {
                agent_run_id: "run-1_a".to_owned(),
                cols: 120,
                rows: 40,
            }
        );
    }

    #[test]
    fn spawn_init_is_rejected_by_name() {
        let raw = r#"{"type":"init","mode":"spawn","agent":"claude","project_id":"p"}"#;
        assert_eq!(
            parse_init(raw),
            Err(InitRejection::SpawnRejected),
            "spawning belongs to GraphQL launches, not this socket"
        );
    }

    #[test]
    fn malformed_first_frames_are_classified_for_the_client() {
        for raw in [
            "",
            "{}",
            r#"{"type":"ready"}"#,
            r#"{"type":"init"}"#,
            r#"{"type":"init","mode":"attach"}"#,
            "not json",
        ] {
            assert_eq!(parse_init(raw), Err(InitRejection::Malformed), "{raw}");
        }
    }

    #[test]
    fn identity_and_geometry_are_validated_before_any_tmux_call() {
        assert_eq!(
            parse_init(
                r#"{"type":"init","mode":"attach","agent_run_id":"rm -rf","cols":80,"rows":24}"#
            ),
            Err(InitRejection::InvalidIdentity)
        );
        assert_eq!(
            parse_init(
                r#"{"type":"init","mode":"attach","agent_run_id":"run-ok","cols":0,"rows":501}"#
            ),
            Err(InitRejection::InvalidGeometry)
        );
        assert!(validate_run_id("approved-run_123"));
        assert!(!validate_run_id(""));
        assert!(!validate_run_id(&"a".repeat(129)));
        assert!(validate_geometry(1, MAX_GEOMETRY));
        assert!(!validate_geometry(MAX_GEOMETRY + 1, 24));
        assert!(!validate_geometry(80, 0));
        assert!(MAX_INPUT_BYTES < 1024 * 1024);
    }

    #[test]
    fn server_frames_keep_the_historical_wire_shape() {
        let ready = ServerFrame::Ready {
            session_id: "ws-abc".to_owned(),
            agent_run_id: "run-1".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(&ready).unwrap(),
            serde_json::json!({
                "type": "ready",
                "session_id": "ws-abc",
                "agent_run_id": "run-1",
            })
        );
        let error = ServerFrame::Error {
            message: "bad_init".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({"type": "error", "message": "bad_init"})
        );
    }

    #[test]
    fn every_close_is_meaningful() {
        assert_eq!(SessionClose::Normal("detached").close_code(), CLOSE_NORMAL);
        assert_eq!(
            SessionClose::Rejected(InitRejection::SpawnRejected).close_code(),
            CLOSE_POLICY_VIOLATION
        );
        assert_eq!(SessionClose::SessionNotFound.close_code(), 1008);
        assert_eq!(
            SessionClose::SessionEnded.message().as_deref(),
            Some("session_ended")
        );
        assert_eq!(SessionClose::TooManySessions.close_code(), 1013);
        assert_eq!(SessionClose::InputTooLarge.close_code(), 1009);
        assert_eq!(SessionClose::LeaseLost.close_code(), 4009);
        assert_eq!(
            SessionClose::AttachmentFailed("pty".to_owned()).close_code(),
            1011
        );
        // Both pressure endings map to "try again later" (1013) and name the
        // exhausted boundary so a support report can tell them apart.
        for (close, message) in [
            (&SessionClose::OutputPressure, "terminal_output_pressure"),
            (&SessionClose::InputPressure, "terminal_input_pressure"),
        ] {
            assert_eq!(close.close_code(), CLOSE_PRESSURE);
            assert_eq!(close.message().as_deref(), Some(message));
        }
        assert!(SessionClose::TransportGone.message().is_none());
    }

    #[test]
    fn init_rejections_produce_a_reportable_close() {
        // Regression: the rejection path must route through finish_socket, so
        // every classified first frame that is not an attachment request or a
        // dead transport has to carry a close code plus error-frame text.
        let closes = vec![
            classify_init(Some(Ok(Message::Text(Utf8Bytes::from(
                r#"{"type":"init","mode":"spawn","agent":"claude"}"#,
            )))))
            .expect_err("spawn must be rejected"),
            classify_init(Some(Ok(Message::Text(Utf8Bytes::from("not json")))))
                .expect_err("malformed text must be rejected"),
            classify_init(Some(Ok(Message::Binary(axum::body::Bytes::from_static(
                b"binary init",
            )))))
            .expect_err("non-text first frames must be rejected"),
            classify_init(None).expect_err("dead transport still returns a close value"),
        ];
        for close in closes {
            let (code, reason) = match &close {
                SessionClose::TransportGone => continue,
                other => other.finished_close(),
            };
            assert_ne!(code, CLOSE_NORMAL);
            assert!(!reason.is_empty());
        }
    }

    #[test]
    fn loopback_gate_admits_only_loopback_hosts() {
        let allowed_hosts = [
            "127.0.0.1",
            "127.0.0.1:8790",
            "localhost",
            "localhost:5174",
            "[::1]",
            "[::1]:8790",
        ];
        for host in allowed_hosts {
            assert_eq!(loopback_gate(Some(host), None), Ok(()), "{host}");
        }

        let rejected_hosts = [
            None,
            Some(""),
            Some("example.com"),
            Some("example.com:80"),
            Some("127.0.0.2"),
            Some("0.0.0.0"),
            Some("::1"),  // unbracketed IPv6 is not a valid Host authority
            Some("[::1"), // unclosed bracket
            Some("[::1]evil"),
            Some("[::1]:not-a-port"),
            Some("localhost:99999"),
            Some("127.0.0.1:not-a-port"),
            Some("user@localhost:8790"),
            Some("evil-127.0.0.1.example.com"),
        ];
        for host in rejected_hosts {
            assert!(loopback_gate(host, None).is_err(), "{host:?}");
        }
    }

    #[test]
    fn loopback_gate_requires_a_loopback_http_origin_when_present() {
        for origin in [
            "http://127.0.0.1:5174",
            "http://localhost:5174",
            "https://[::1]:5174",
            "HTTP://LOCALHOST",
        ] {
            let host = if origin.starts_with("https://") {
                "[::1]:5174"
            } else {
                "127.0.0.1:5174"
            };
            assert_eq!(loopback_gate(Some(host), Some(origin)), Ok(()), "{origin}");
        }

        for (host, origin) in [
            ("127.0.0.1", "ftp://127.0.0.1"),
            ("127.0.0.1", "file:///etc/passwd"),
            ("127.0.0.1", ""),
            ("127.0.0.1", "not a url"),
            ("127.0.0.1", "http://example.com"),
            ("127.0.0.1", "http://example.com:8790"),
            ("127.0.0.1", "http://127.0.0.1.example.com"),
            ("127.0.0.1", "http://localhost:5174/studio"),
            ("127.0.0.1", "http://localhost:99999"),
            ("127.0.0.1", "http://user@localhost:5174"),
        ] {
            assert!(
                loopback_gate(Some(host), Some(origin)).is_err(),
                "{host} + {origin}"
            );
        }
        // A missing Origin passes only after Host has passed.
        assert_eq!(loopback_gate(Some("127.0.0.1"), None), Ok(()));
    }
}
