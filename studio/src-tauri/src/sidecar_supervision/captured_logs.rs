//! In-memory capture of sidecar output, and the threads that feed it.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use super::error::{FailureKind, SupervisorError};
use super::log_redaction::RedactedLogBuffer;
use super::log_rotation::RotatingSidecarLog;
use super::owned_sidecar::OwnedSidecar;

pub(super) struct CapturedLogs {
    pub(super) memory: RedactedLogBuffer,
    pub(super) disk: RotatingSidecarLog,
    pub(super) disk_error: Option<String>,
}

impl CapturedLogs {
    pub(super) fn new(
        memory_limit: usize,
        disk_limit: usize,
        disk_generations: usize,
        secret: String,
        disk_path: PathBuf,
    ) -> std::io::Result<Self> {
        Ok(Self {
            memory: RedactedLogBuffer::new(memory_limit, secret),
            disk: RotatingSidecarLog::new(disk_path, disk_limit, disk_generations)?,
            disk_error: None,
        })
    }

    pub(super) fn redact(&self, value: &str) -> String {
        self.memory.redact(value)
    }

    pub(super) fn push_redacted(&mut self, line: String) {
        self.memory.push(line.clone());
        if let Err(error) = self.disk.push(&line) {
            self.disk_error = Some(error.to_string());
        }
    }

    pub(super) fn snapshot(&self) -> Vec<String> {
        self.memory.snapshot()
    }

    pub(super) fn replace_secret(&mut self, secret: String) {
        self.memory.replace_secret(secret);
    }

    pub(super) fn take_disk_error(&mut self) -> Option<String> {
        self.disk_error.take()
    }
}

pub(super) fn start_log_readers(
    sidecar: &mut OwnedSidecar,
    logs: Arc<Mutex<CapturedLogs>>,
) -> Result<mpsc::Receiver<String>, SupervisorError> {
    let stdout = sidecar.take_stdout().ok_or_else(|| {
        SupervisorError::new(FailureKind::Crash, "sidecar stdout was not captured")
    })?;
    let stderr = sidecar.take_stderr().ok_or_else(|| {
        SupervisorError::new(FailureKind::Crash, "sidecar stderr was not captured")
    })?;
    let (sender, receiver) = mpsc::channel();
    read_pipe(stdout, Some(sender), Arc::clone(&logs));
    read_pipe(stderr, None, logs);
    Ok(receiver)
}

pub(super) fn read_pipe<R: std::io::Read + Send + 'static>(
    pipe: R,
    readiness: Option<mpsc::Sender<String>>,
    logs: Arc<Mutex<CapturedLogs>>,
) {
    thread::spawn(move || {
        for result in BufReader::new(pipe).lines() {
            let Ok(raw_line) = result else { break };
            {
                let mut buffer = logs.lock().expect("logs lock poisoned");
                let redacted = buffer.redact(&raw_line);
                buffer.push_redacted(redacted);
            }
            if let Some(sender) = &readiness {
                let _ = sender.send(raw_line);
            }
        }
    });
}
