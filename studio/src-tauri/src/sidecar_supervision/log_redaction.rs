//! Redaction of the sidecar credential from captured output.
//!
//! Log capture happens on the reader threads, so redaction has to be cheap and
//! streaming rather than a pass over a finished buffer.

use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub(super) struct RedactedLogBuffer {
    pub(super) lines: VecDeque<String>,
    pub(super) bytes: usize,
    pub(super) limit: usize,
    pub(super) secret: String,
}

impl RedactedLogBuffer {
    pub(super) fn new(limit: usize, secret: String) -> Self {
        Self {
            lines: VecDeque::new(),
            bytes: 0,
            limit,
            secret,
        }
    }

    pub(super) fn redact(&self, value: &str) -> String {
        value.replace(&self.secret, "[REDACTED]")
    }

    pub(super) fn push(&mut self, line: String) {
        let line_bytes = line.len() + 1;
        if self.limit == 0 || line_bytes > self.limit {
            return;
        }
        while self.bytes + line_bytes > self.limit {
            if let Some(evicted) = self.lines.pop_front() {
                self.bytes = self.bytes.saturating_sub(evicted.len() + 1);
            } else {
                break;
            }
        }
        self.bytes += line_bytes;
        self.lines.push_back(line);
    }

    pub(super) fn snapshot(&self) -> Vec<String> {
        self.lines.iter().cloned().collect()
    }

    pub(super) fn replace_secret(&mut self, secret: String) {
        self.secret = secret;
    }
}
