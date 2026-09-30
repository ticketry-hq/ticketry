use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// The resident child could not be reached or kept exiting.
    Transport,
    /// A reply did not match the protocol Ticketry expects.
    Protocol,
    /// The resident capability is not running and will not be retried now.
    Unavailable,
    /// The app-server answered with a JSON-RPC error.
    Provider,
    /// The app-server answered with a JSON-RPC error naming an unknown thread.
    UnknownThread,
}

#[derive(Debug)]
pub struct CodexAppServerError {
    message: String,
    kind: Kind,
}

impl CodexAppServerError {
    /// Build an unavailable result from an alternate or scripted reader.
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::of(Kind::Unavailable, message)
    }

    /// Whether Codex rejected the request because it does not know the thread.
    pub fn is_unknown_thread(&self) -> bool {
        self.kind == Kind::UnknownThread
    }

    /// Whether the resident app-server was never started or gave up restarting.
    pub fn is_unavailable(&self) -> bool {
        self.kind == Kind::Unavailable
    }

    pub(crate) fn transport(message: impl Into<String>) -> Self {
        Self::of(Kind::Transport, message)
    }

    pub(crate) fn protocol(message: impl Into<String>) -> Self {
        Self::of(Kind::Protocol, message)
    }

    /// Classify a JSON-RPC error reply. Codex owns the wording, so an unknown
    /// thread is recognised by the phrases its app-server uses rather than by a
    /// reserved code.
    pub(crate) fn provider(message: impl Into<String>) -> Self {
        let message = message.into();
        let lowercase = message.to_lowercase();
        let unknown_thread = ["not found", "no such thread", "unknown thread"]
            .iter()
            .any(|phrase| lowercase.contains(phrase));
        Self::of(
            if unknown_thread {
                Kind::UnknownThread
            } else {
                Kind::Provider
            },
            message,
        )
    }

    pub(crate) fn timeout(method: &str) -> Self {
        Self::of(
            Kind::Transport,
            format!("codex app-server {method} timed out after 5 seconds"),
        )
    }

    pub(crate) fn is_transport(&self) -> bool {
        self.kind == Kind::Transport
    }

    fn of(kind: Kind, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind,
        }
    }
}

impl fmt::Display for CodexAppServerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CodexAppServerError {}
