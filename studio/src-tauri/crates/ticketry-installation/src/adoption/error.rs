//! Why adoption stopped, and what the installation is when it did.
//!
//! Every refusal names the phase it stopped in and a stable reason. That pair
//! is what the startup UI needs to distinguish an unsupported source from a
//! semantic refusal, a snapshot failure, a postflight failure, and a recovery
//! that now needs a person — and what support needs to know whether the source
//! is still the reusable one.
//!
//! A failure is never partial success. Readiness stays closed on every one of
//! these, so no mutation is ever accepted from a run that produced one.

use serde::Serialize;

use super::phase::Phase;

/// The stable machine-readable reason adoption refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Refusal {
    /// Another live process holds the installation lease.
    LeaseUnavailable,
    /// Another process holds the database open; the exclusive phase cannot
    /// start while a Django, FastMCP, or second Ticketry writer is attached.
    InstallationBusy,
    /// Classification refused. The source is not one this release supports.
    UnsupportedSource,
    /// The content cannot be carried forward, with defects reported.
    SemanticRefusal,
    /// A historical generation needs a bridge this release does not carry.
    BridgeRequired,
    /// A named bridge's recorded source requirements did not hold.
    BridgePreconditionFailed,
    /// A bridge ran but did not produce its recorded canonical schema.
    BridgePostconditionFailed,
    /// The requested bridge sequence was not the one recorded for the source.
    InvalidBridgeOrder,
    /// A PostgreSQL source is imported, not adopted in place.
    ImportRequired,
    /// The write-ahead log could not be moved into the database file.
    CheckpointFailed,
    /// The recovery snapshot could not be created, hashed, or reopened.
    SnapshotFailed,
    /// The migration ledger could not be committed.
    LedgerFailed,
    /// The adopted database did not reproduce the source it came from.
    PostflightFailed,
    /// The new authoritative event boundary could not be published.
    EventBoundaryFailed,
    /// A first launch could not be provisioned at the Rust leaf.
    ProvisioningFailed,
    /// A deterministic fault point fired. Tests only; never shipping.
    InjectedFault,
}

impl Refusal {
    /// Whether the source is still exactly the database adoption started with.
    ///
    /// Restoring the snapshot is only *necessary* past this line. Before it,
    /// the installation was never mutated, so retry or downgrade is a decision
    /// rather than a recovery.
    #[must_use]
    pub const fn source_is_untouched(self) -> bool {
        matches!(
            self,
            Self::LeaseUnavailable
                | Self::InstallationBusy
                | Self::UnsupportedSource
                | Self::SemanticRefusal
                | Self::BridgeRequired
                | Self::ImportRequired
        )
    }
}

/// One refusal: the phase it happened in, why, and an operator-safe detail.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionFailure {
    phase: Phase,
    refusal: Refusal,
    detail: String,
}

impl AdoptionFailure {
    pub fn new(phase: Phase, refusal: Refusal, detail: impl Into<String>) -> Self {
        Self {
            phase,
            refusal,
            detail: detail.into(),
        }
    }

    /// The phase adoption stopped in.
    #[must_use]
    pub const fn phase(&self) -> Phase {
        self.phase
    }

    /// The stable reason, for the startup UI and for support.
    #[must_use]
    pub const fn refusal(&self) -> Refusal {
        self.refusal
    }

    /// The explanation. It names schema, count, and identity facts only.
    #[must_use]
    pub fn detail(&self) -> &str {
        &self.detail
    }

    /// The recovery sentence this refusal earns.
    ///
    /// Automatic recovery is the verified snapshot, and it is only the
    /// automatic path while readiness is closed — which it always is here.
    #[must_use]
    pub fn recovery(&self) -> &'static str {
        if self.refusal.source_is_untouched() {
            "The installation was not changed. Resolve the reported condition and start Ticketry again."
        } else {
            "The installation was not opened for writing. Restore the verified recovery snapshot recorded beside it, or contact support with the adoption evidence file."
        }
    }
}

impl std::fmt::Display for AdoptionFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "adoption stopped in {} ({:?}): {}",
            self.phase.label(),
            self.refusal,
            self.detail
        )
    }
}

impl std::error::Error for AdoptionFailure {}

#[cfg(test)]
mod tests {
    use super::{AdoptionFailure, Phase, Refusal};

    #[test]
    fn a_refusal_before_the_first_write_says_the_source_is_untouched() {
        let failure = AdoptionFailure::new(
            Phase::Preflight,
            Refusal::SemanticRefusal,
            "2 defect(s) with no bridge",
        );
        assert!(failure.refusal().source_is_untouched());
        assert!(failure.recovery().contains("not changed"));
    }

    #[test]
    fn a_refusal_after_the_exclusive_phase_points_at_the_snapshot() {
        let failure = AdoptionFailure::new(
            Phase::Postflight,
            Refusal::PostflightFailed,
            "row counts disagree",
        );
        assert!(!failure.refusal().source_is_untouched());
        assert!(failure.recovery().contains("recovery snapshot"));
    }
}
