//! The ordered phases of one adoption, and the fault points around them.
//!
//! Adoption is the migration's least reversible step, so the order it runs in
//! is a product decision rather than an implementation detail: exclusivity
//! before any write, a verified recovery point before any mutation, the ledger
//! before any validation of the adopted result, and readiness last. The phase
//! list states that order once, and every failure names the phase it stopped
//! in so a refusal says where the installation now stands.
//!
//! Each phase is also a deterministic fault point. A test asks for a failure
//! *after* a named phase and gets exactly that — the phase's effects happened,
//! the next phase did not — which is how the crash boundaries either side of
//! the ledger commit are proven rather than argued.

use serde::Serialize;

/// One step of the adoption sequence, in the order it runs.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    /// Prove this process holds the installation lease.
    LeaseAcquisition,
    /// Identify the installation exactly, read-only.
    Classification,
    /// Decide whether its content can be carried forward, read-only.
    Preflight,
    /// Prove no other writer holds the installation open.
    WriterShutdown,
    /// Move every committed write-ahead-log frame into the database file.
    WalCheckpoint,
    /// Copy the source to a private recovery snapshot.
    SnapshotCopy,
    /// Hash the snapshot and reopen it independently.
    HashVerification,
    /// Apply named historical bridges. No bridge ships in this release.
    BridgeWork,
    /// Commit the Rust migration ledger transactionally.
    LedgerCommit,
    /// Compare counts and digests, rerun invariants, prove reads.
    Postflight,
    /// Publish one new authoritative event boundary.
    EventBoundary,
    /// Open readiness, after which mutations are accepted.
    Readiness,
    /// Create a first-launch installation directly at the Rust leaf.
    Provisioning,
}

impl Phase {
    /// The phase name used in refusals and evidence.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::LeaseAcquisition => "lease acquisition",
            Self::Classification => "classification",
            Self::Preflight => "preflight",
            Self::WriterShutdown => "writer shutdown",
            Self::WalCheckpoint => "WAL checkpoint",
            Self::SnapshotCopy => "snapshot copy",
            Self::HashVerification => "hash verification",
            Self::BridgeWork => "bridge work",
            Self::LedgerCommit => "ledger commit",
            Self::Postflight => "postflight",
            Self::EventBoundary => "event boundary",
            Self::Readiness => "readiness",
            Self::Provisioning => "provisioning",
        }
    }
}

/// How one adoption run is asked to behave.
///
/// The default is what shipping startup uses. `fault` exists so the recovery
/// paths can be exercised deterministically instead of by racing a real crash.
#[derive(Clone, Debug, Default)]
pub struct AdoptionPlan {
    /// Fail immediately after this phase completes, leaving its effects.
    pub fault: Option<Phase>,
}

impl AdoptionPlan {
    /// A plan that fails right after `phase`, for a crash-boundary test.
    #[must_use]
    pub const fn failing_after(phase: Phase) -> Self {
        Self { fault: Some(phase) }
    }

    pub(crate) fn faults_after(&self, phase: Phase) -> bool {
        self.fault == Some(phase)
    }
}

#[cfg(test)]
mod tests {
    use super::{AdoptionPlan, Phase};

    #[test]
    fn a_plan_faults_only_after_the_phase_it_names() {
        let plan = AdoptionPlan::failing_after(Phase::LedgerCommit);
        assert!(plan.faults_after(Phase::LedgerCommit));
        assert!(!plan.faults_after(Phase::Postflight));
        assert!(!plan.faults_after(Phase::WalCheckpoint));
    }

    #[test]
    fn the_default_plan_injects_nothing() {
        assert!(AdoptionPlan::default().fault.is_none());
        assert!(!AdoptionPlan::default().faults_after(Phase::Readiness));
    }

    #[test]
    fn readiness_is_the_last_phase_in_the_sequence() {
        // Provisioning is a first-launch alternative to the adoption phases,
        // not a step after readiness, so the ordering assertion excludes it.
        assert!(Phase::Readiness > Phase::EventBoundary);
        assert!(Phase::LeaseAcquisition < Phase::Classification);
        assert!(Phase::LedgerCommit < Phase::Postflight);
    }
}
