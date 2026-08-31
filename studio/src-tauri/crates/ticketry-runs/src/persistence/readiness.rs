//! One versioned readiness result for the complete Slice 3 Runs runtime.
//!
//! The gate is deliberately all-or-nothing. A partially ready runtime answers
//! structured unavailable errors; it never degrades to a second writer, and
//! there is no Django fallback to fall back to.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ownership_manifest::VERSION;
use super::status_frames::SUPPORTED_PAYLOAD_VERSION;
use super::{RunsPersistenceError, RunsPersistenceErrorCode};

pub const READINESS_FILE: &str = "slice3-readiness.json";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Slice3Readiness {
    pub version: i32,
    /// The Runs schema was adopted and the write lease is held by Rust.
    pub runs_ownership: bool,
    /// Prepared and ambiguously claimed launch effects were reconciled.
    pub effect_reconciliation: bool,
    /// Authoritative Runs queries and the status subscription are registered.
    pub graphql_status: bool,
    /// The retained event payload version this build can read.
    pub event_payload_version: i32,
    /// The temporary Python effect executor answered its health probe.
    pub compatibility_executor: bool,
    pub ready: bool,
    /// Always false. It exists so the published record states, rather than
    /// merely implies, that no Django writer remains reachable.
    pub django_write_fallback: bool,
}

impl Slice3Readiness {
    pub fn unavailable() -> Self {
        Self {
            version: VERSION,
            runs_ownership: false,
            effect_reconciliation: false,
            graphql_status: false,
            event_payload_version: SUPPORTED_PAYLOAD_VERSION,
            compatibility_executor: false,
            ready: false,
            django_write_fallback: false,
        }
    }

    pub fn complete() -> Self {
        Self {
            version: VERSION,
            runs_ownership: true,
            effect_reconciliation: true,
            graphql_status: true,
            event_payload_version: SUPPORTED_PAYLOAD_VERSION,
            compatibility_executor: true,
            ready: true,
            django_write_fallback: false,
        }
    }

    pub fn validate(&self) -> Result<(), RunsPersistenceError> {
        if self.version != VERSION {
            return Err(incompatible(format!(
                "unknown Slice 3 readiness version {}",
                self.version
            )));
        }
        if self.event_payload_version != SUPPORTED_PAYLOAD_VERSION {
            return Err(incompatible(format!(
                "unsupported retained event payload version {}",
                self.event_payload_version
            )));
        }
        let complete = self.runs_ownership
            && self.effect_reconciliation
            && self.graphql_status
            && self.compatibility_executor
            && !self.django_write_fallback;
        if self.ready != complete {
            return Err(incompatible(
                "partial Slice 3 readiness cannot serve Runs commands or status",
            ));
        }
        Ok(())
    }
}

pub fn publish(
    data_directory: &Path,
    readiness: &Slice3Readiness,
) -> Result<(), RunsPersistenceError> {
    readiness.validate()?;
    let destination = data_directory.join(READINESS_FILE);
    let temporary = data_directory.join(format!(".{READINESS_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let encoded = serde_json::to_vec_pretty(readiness)
        .map_err(|error| unavailable(format!("could not encode Slice 3 readiness: {error}")))?;
    std::fs::write(&temporary, &encoded).map_err(io_error)?;
    std::fs::rename(&temporary, &destination).map_err(io_error)
}

/// Whether the exact complete result is published. Anything else — missing,
/// malformed, unknown field, partial, or a stale record from an older build —
/// keeps the gate closed.
pub fn published_readiness_is_complete(data_directory: &Path) -> bool {
    let Ok(contents) = std::fs::read(data_directory.join(READINESS_FILE)) else {
        return false;
    };
    let Ok(readiness) = serde_json::from_slice::<Slice3Readiness>(&contents) else {
        return false;
    };
    readiness == Slice3Readiness::complete() && readiness.validate().is_ok()
}

/// The structured refusal every Runs surface returns while the gate is closed.
pub fn unavailable_error() -> RunsPersistenceError {
    RunsPersistenceError::new(
        RunsPersistenceErrorCode::AdoptionUnavailable,
        "The Runs runtime is not ready; Runs commands and status are unavailable.",
    )
}

fn io_error(source: std::io::Error) -> RunsPersistenceError {
    unavailable(format!("Slice 3 readiness file operation failed: {source}"))
}
fn unavailable(message: impl Into<String>) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::AdoptionUnavailable, message)
}
fn incompatible(message: impl Into<String>) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::IncompatibleSchema, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_partial_result_cannot_claim_readiness() {
        for close in [
            |readiness: &mut Slice3Readiness| readiness.runs_ownership = false,
            |readiness: &mut Slice3Readiness| readiness.effect_reconciliation = false,
            |readiness: &mut Slice3Readiness| readiness.graphql_status = false,
            |readiness: &mut Slice3Readiness| readiness.compatibility_executor = false,
            |readiness: &mut Slice3Readiness| readiness.django_write_fallback = true,
        ] {
            let mut readiness = Slice3Readiness::complete();
            close(&mut readiness);
            assert!(readiness.validate().is_err());
        }
    }

    #[test]
    fn an_unreadable_event_version_is_refused() {
        let mut readiness = Slice3Readiness::complete();
        readiness.event_payload_version = SUPPORTED_PAYLOAD_VERSION + 1;
        assert!(readiness.validate().is_err());
    }

    #[test]
    fn the_closed_gate_is_itself_a_valid_result() {
        assert!(Slice3Readiness::unavailable().validate().is_ok());
    }

    #[test]
    fn missing_partial_or_unknown_published_results_keep_the_gate_closed() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        assert!(!published_readiness_is_complete(directory.path()));

        publish(directory.path(), &Slice3Readiness::unavailable())
            .expect("publish the closed gate");
        assert!(!published_readiness_is_complete(directory.path()));

        std::fs::write(
            directory.path().join(READINESS_FILE),
            br#"{"version":1,"runs_ownership":true,"effect_reconciliation":true,"graphql_status":true,"event_payload_version":1,"compatibility_executor":true,"ready":true,"django_write_fallback":false,"unknown":true}"#,
        )
        .expect("write a readiness record with an unknown field");
        assert!(!published_readiness_is_complete(directory.path()));

        publish(directory.path(), &Slice3Readiness::complete()).expect("publish readiness");
        assert!(published_readiness_is_complete(directory.path()));
    }

    #[test]
    fn publishing_a_partial_result_is_refused_rather_than_written() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let mut partial = Slice3Readiness::complete();
        partial.effect_reconciliation = false;
        assert!(publish(directory.path(), &partial).is_err());
        assert!(!directory.path().join(READINESS_FILE).exists());
    }
}
