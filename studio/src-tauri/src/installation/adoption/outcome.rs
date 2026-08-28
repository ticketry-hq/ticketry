//! What one completed adoption run says about the installation it left behind.
//!
//! The record is evidence, not a log line: it is written beside the
//! installation, read by recovery tooling, and compared by tests. It therefore
//! carries identities, counts, digests, and versions — never a path inside the
//! user's work, a credential, a prompt, or a provider command line.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;

use super::snapshot::SnapshotRecord;

/// Which of the three supported startup paths this run took.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AdoptionPath {
    /// A first launch, created directly at the current Rust leaf.
    Provisioned,
    /// A current SQLite installation, adopted in place.
    Adopted,
    /// A historical SQLite installation corrected to the canonical leaf.
    Bridged,
    /// A PostgreSQL source, copied into a canonical SQLite installation.
    Imported,
    /// An installation Rust already owns, reopened without change.
    Reopened,
}

/// Whether Ticketry may accept a mutation against this installation.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Readiness {
    /// Every phase passed. The first Rust mutation may now be accepted.
    Open,
    /// Some phase did not pass. No mutation is accepted.
    Closed,
}

/// The one new authoritative event boundary this session published.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBoundary {
    /// The projects that received a boundary event, in identity order.
    pub projects: Vec<String>,
    /// The highest event cursor the boundary occupies.
    pub cursor: i64,
    /// How many historical rows existed before it. None were republished.
    pub prior_events: u64,
}

/// The complete result of one adoption run.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adoption {
    /// Which startup path ran.
    pub path: AdoptionPath,
    /// The classified generation the run started from.
    pub generation: String,
    /// The source's checked product-schema fingerprint.
    pub source_fingerprint: String,
    /// The Ticketry version that performed the adoption.
    pub application_version: String,
    /// The Rust migration leaf the installation is now at.
    pub rust_leaf: String,
    /// Ordered historical bridge IDs committed with ownership.
    pub bridges: Vec<String>,
    /// The verified recovery snapshot, when this run created one.
    pub snapshot: Option<SnapshotRecord>,
    /// Rows per product table after adoption.
    pub counts: BTreeMap<String, u64>,
    /// The canonical preserved-field digest of every product table.
    pub preserved_digest: String,
    /// The boundary published before the first mutation.
    pub event_boundary: Option<EventBoundary>,
    /// Whether mutations may now be accepted.
    pub readiness: Readiness,
    /// Whether a previous launch already completed this adoption.
    ///
    /// Kept out of the serialized evidence: it describes this run's decision,
    /// not the installation, and a support engineer reading the file would take
    /// it for a fact about the database.
    #[serde(skip)]
    pub previously_ready: bool,
}

impl Adoption {
    /// Where the evidence file for this run is written.
    #[must_use]
    pub fn evidence_path(data_directory: &std::path::Path) -> PathBuf {
        data_directory.join(EVIDENCE_FILE)
    }
}

/// The evidence file adoption writes beside the installation.
pub const EVIDENCE_FILE: &str = "installation-adoption.json";

#[cfg(test)]
mod tests {
    use super::{Adoption, AdoptionPath, Readiness, EVIDENCE_FILE};
    use std::collections::BTreeMap;

    fn record() -> Adoption {
        Adoption {
            path: AdoptionPath::Adopted,
            generation: "django-current".to_owned(),
            source_fingerprint: "f".repeat(64),
            application_version: "0.2.0".to_owned(),
            rust_leaf: "rust-0001".to_owned(),
            bridges: Vec::new(),
            snapshot: None,
            counts: BTreeMap::from([("worktracker_issue".to_owned(), 3)]),
            preserved_digest: "a".repeat(64),
            event_boundary: None,
            readiness: Readiness::Open,
            previously_ready: false,
        }
    }

    #[test]
    fn evidence_serializes_as_facts_a_support_engineer_may_read() {
        let encoded = serde_json::to_string(&record()).expect("encode the adoption record");
        assert!(encoded.contains("\"path\":\"adopted\""));
        assert!(encoded.contains("\"readiness\":\"open\""));
        assert!(encoded.contains("\"worktracker_issue\":3"));
    }

    #[test]
    fn the_evidence_file_sits_beside_the_installation() {
        let path = Adoption::evidence_path(std::path::Path::new("/data"));
        assert_eq!(path, std::path::Path::new("/data").join(EVIDENCE_FILE));
    }
}
