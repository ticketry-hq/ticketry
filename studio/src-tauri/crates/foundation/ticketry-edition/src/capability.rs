//! The edition-gated capabilities and the table of editions that grant each.
//!
//! The table mirrors `config/editions.json` key for key; the crate's parity
//! test compares the two, so change both together.

use crate::Edition;

/// A product capability that only some editions grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EditionCapability {
    SprintPlanning,
    LaunchkeyMidi,
    VoiceTranscription,
    ParallelSubtreeRuns,
    ReviewedWorkflowDefaults,
}

impl EditionCapability {
    /// Every capability, in the manifest's order.
    pub const ALL: [Self; 5] = [
        Self::SprintPlanning,
        Self::LaunchkeyMidi,
        Self::VoiceTranscription,
        Self::ParallelSubtreeRuns,
        Self::ReviewedWorkflowDefaults,
    ];

    /// The capability's camelCase key in `config/editions.json`.
    pub const fn name(self) -> &'static str {
        match self {
            Self::SprintPlanning => "sprintPlanning",
            Self::LaunchkeyMidi => "launchkeyMidi",
            Self::VoiceTranscription => "voiceTranscription",
            Self::ParallelSubtreeRuns => "parallelSubtreeRuns",
            Self::ReviewedWorkflowDefaults => "reviewedWorkflowDefaults",
        }
    }

    /// Whether `edition` grants this capability.
    pub(crate) const fn granted_in(self, edition: Edition) -> bool {
        match self {
            Self::SprintPlanning
            | Self::LaunchkeyMidi
            | Self::VoiceTranscription
            | Self::ParallelSubtreeRuns => matches!(edition, Edition::Core),
            Self::ReviewedWorkflowDefaults => matches!(edition, Edition::Pocock),
        }
    }
}
