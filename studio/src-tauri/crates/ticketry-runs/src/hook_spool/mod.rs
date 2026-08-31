//! Atomic provider-hook ingestion into the authoritative Runs reducer.
//!
//! The packaged hook helper publishes raw provider JSON as a complete `.hook`
//! file. This module is the only consumer. It keeps a valid delivery until the
//! Runs transaction acknowledges it, and moves permanently invalid input out
//! of the scan path.

pub mod directory_layout;
mod mapping;

#[cfg(test)]
mod tests;

pub use directory_layout::{ensure_hook_spool_directory, hook_spool_directory};

use mapping::{
    map_provider_event, open_regular_file, parse_filename, permanent_reducer_error,
    validate_payload_version, PrepareError,
};

use std::ffi::OsStr;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::persistence::{
    LifecycleAcceptance, LifecycleFact, LifecycleService, RunsPersistenceError,
};

pub const MAX_HOOK_BYTES: u64 = 1024 * 1024;
pub const DEFAULT_BATCH_SIZE: usize = 256;
const QUARANTINE_DIRECTORY: &str = "quarantine";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HookDiagnostic {
    SpoolUnavailable,
    InvalidFilename,
    UnsupportedFilenameVersion,
    UnknownProvider,
    UnsafeFileType,
    OversizedPayload,
    InvalidJson,
    UnsupportedPayloadVersion,
    InvalidPayload,
    QuarantineUnavailable,
    DurableAcceptanceUnavailable,
    RemovalUnavailable,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DrainReport {
    pub scanned: usize,
    pub accepted: usize,
    pub no_op: usize,
    pub quarantined: usize,
    pub retained: usize,
    pub diagnostics: Vec<HookDiagnostic>,
}

#[derive(Debug)]
pub struct HookSpoolError {
    diagnostic: HookDiagnostic,
}

impl HookSpoolError {
    fn new(diagnostic: HookDiagnostic) -> Self {
        Self { diagnostic }
    }

    pub fn diagnostic(&self) -> HookDiagnostic {
        self.diagnostic
    }
}

impl std::fmt::Display for HookSpoolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("The provider hook spool is unavailable.")
    }
}

impl std::error::Error for HookSpoolError {}

#[async_trait]
pub trait HookLifecycleSink: Send + Sync + 'static {
    async fn accept(
        &self,
        fact: LifecycleFact,
    ) -> Result<LifecycleAcceptance, RunsPersistenceError>;
}

#[async_trait]
impl HookLifecycleSink for LifecycleService {
    async fn accept(
        &self,
        fact: LifecycleFact,
    ) -> Result<LifecycleAcceptance, RunsPersistenceError> {
        self.apply_lifecycle_fact(fact).await
    }
}

pub struct HookSpool<S = LifecycleService> {
    root: PathBuf,
    sink: Arc<S>,
    batch_size: usize,
    drain_lock: Arc<Mutex<()>>,
}

impl<S> Clone for HookSpool<S> {
    fn clone(&self) -> Self {
        Self {
            root: self.root.clone(),
            sink: Arc::clone(&self.sink),
            batch_size: self.batch_size,
            drain_lock: Arc::clone(&self.drain_lock),
        }
    }
}

impl<S: HookLifecycleSink> HookSpool<S> {
    pub fn new(root: PathBuf, sink: S, batch_size: usize) -> Result<Self, HookSpoolError> {
        if !root.is_absolute() || batch_size == 0 {
            return Err(HookSpoolError::new(HookDiagnostic::SpoolUnavailable));
        }
        Ok(Self {
            root,
            sink: Arc::new(sink),
            batch_size,
            drain_lock: Arc::new(Mutex::new(())),
        })
    }

    pub async fn drain_once(&self) -> DrainReport {
        let _guard = self.drain_lock.lock().await;
        let mut report = DrainReport::default();
        let paths = match self.scan() {
            Ok(paths) => paths,
            Err(diagnostic) => {
                report.diagnostics.push(diagnostic);
                return report;
            }
        };
        report.scanned = paths.len();

        for path in paths {
            match self.prepare(&path) {
                Ok(Some(fact)) => match self.sink.accept(fact).await {
                    Ok(_) => self.remove_after_acceptance(&path, true, &mut report),
                    Err(error) if permanent_reducer_error(error.code()) => {
                        self.quarantine(&path, HookDiagnostic::InvalidPayload, &mut report)
                    }
                    Err(_) => {
                        report.retained += 1;
                        report
                            .diagnostics
                            .push(HookDiagnostic::DurableAcceptanceUnavailable);
                    }
                },
                Ok(None) => self.remove_after_acceptance(&path, false, &mut report),
                Err(PrepareError::Permanent(diagnostic)) => {
                    self.quarantine(&path, diagnostic, &mut report)
                }
                Err(PrepareError::Transient(diagnostic)) => {
                    report.retained += 1;
                    report.diagnostics.push(diagnostic);
                }
            }
        }
        report
    }

    /// A required lifecycle drain first proves the spool root itself is safe.
    /// `drain_once` remains report-only for best-effort callers and tests.
    pub async fn drain_required(&self) -> Result<DrainReport, HookSpoolError> {
        self.validate_root()?;
        Ok(self.drain_once().await)
    }

    pub async fn start(
        self,
        interval: Duration,
    ) -> Result<(DrainReport, HookSpoolRuntime<S>), HookSpoolError> {
        self.validate_root()?;
        if interval.is_zero() {
            return Err(HookSpoolError::new(HookDiagnostic::SpoolUnavailable));
        }
        let startup = self.drain_once().await;
        let cancellation = CancellationToken::new();
        let worker_cancellation = cancellation.clone();
        let worker_spool = self.clone();
        let worker = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.tick().await;
            loop {
                tokio::select! {
                    biased;
                    _ = worker_cancellation.cancelled() => break,
                    _ = ticker.tick() => { worker_spool.drain_once().await; }
                }
            }
        });
        Ok((
            startup,
            HookSpoolRuntime {
                spool: self,
                cancellation,
                worker,
            },
        ))
    }

    fn validate_root(&self) -> Result<(), HookSpoolError> {
        let metadata = fs::symlink_metadata(&self.root)
            .map_err(|_| HookSpoolError::new(HookDiagnostic::SpoolUnavailable))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(HookSpoolError::new(HookDiagnostic::SpoolUnavailable));
        }
        Ok(())
    }

    fn scan(&self) -> Result<Vec<PathBuf>, HookDiagnostic> {
        self.validate_root()
            .map_err(|_| HookDiagnostic::SpoolUnavailable)?;
        let mut paths = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| HookDiagnostic::SpoolUnavailable)? {
            let path = entry.map_err(|_| HookDiagnostic::SpoolUnavailable)?.path();
            if path.extension() == Some(OsStr::new("hook")) {
                paths.push(path);
            }
        }
        paths.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
        paths.truncate(self.batch_size);
        Ok(paths)
    }

    fn prepare(&self, path: &Path) -> Result<Option<LifecycleFact>, PrepareError> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| PrepareError::transient(HookDiagnostic::SpoolUnavailable))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(PrepareError::permanent(HookDiagnostic::UnsafeFileType));
        }
        if metadata.len() > MAX_HOOK_BYTES {
            return Err(PrepareError::permanent(HookDiagnostic::OversizedPayload));
        }
        let filename = parse_filename(path)?;
        let mut file = open_regular_file(path)?;
        let mut payload = Vec::with_capacity(metadata.len() as usize);
        file.by_ref()
            .take(MAX_HOOK_BYTES + 1)
            .read_to_end(&mut payload)
            .map_err(|_| PrepareError::transient(HookDiagnostic::SpoolUnavailable))?;
        if payload.len() as u64 > MAX_HOOK_BYTES {
            return Err(PrepareError::permanent(HookDiagnostic::OversizedPayload));
        }
        let value: Value = serde_json::from_slice(&payload)
            .map_err(|_| PrepareError::permanent(HookDiagnostic::InvalidJson))?;
        let object = value
            .as_object()
            .ok_or_else(|| PrepareError::permanent(HookDiagnostic::InvalidPayload))?;
        validate_payload_version(object)?;
        map_provider_event(filename.provider, filename.agent_run_id, object)
    }

    fn remove_after_acceptance(&self, path: &Path, accepted: bool, report: &mut DrainReport) {
        match fs::remove_file(path) {
            Ok(()) => {
                if accepted {
                    report.accepted += 1;
                } else {
                    report.no_op += 1;
                }
            }
            Err(_) => {
                report.retained += 1;
                report.diagnostics.push(HookDiagnostic::RemovalUnavailable);
            }
        }
    }

    fn quarantine(&self, path: &Path, diagnostic: HookDiagnostic, report: &mut DrainReport) {
        let directory = self.root.join(QUARANTINE_DIRECTORY);
        let result = fs::create_dir_all(&directory).and_then(|()| {
            let filename = path.file_name().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "missing spool filename")
            })?;
            let destination = directory.join(format!(
                "{}.{}.invalid",
                filename.to_string_lossy(),
                uuid::Uuid::new_v4().simple()
            ));
            fs::rename(path, destination)
        });
        if result.is_ok() {
            report.quarantined += 1;
            report.diagnostics.push(diagnostic);
        } else {
            report.retained += 1;
            report
                .diagnostics
                .push(HookDiagnostic::QuarantineUnavailable);
        }
    }
}

pub struct HookSpoolRuntime<S: HookLifecycleSink = LifecycleService> {
    spool: HookSpool<S>,
    cancellation: CancellationToken,
    worker: JoinHandle<()>,
}

impl<S: HookLifecycleSink> HookSpoolRuntime<S> {
    pub async fn shutdown(self) -> DrainReport {
        self.cancellation.cancel();
        let _ = self.worker.await;
        self.spool.drain_once().await
    }
}
