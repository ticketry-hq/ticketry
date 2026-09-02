//! How a transition handoff reached its agent session.
//!
//! An Automation Attempt records this once, durably: the handoff was either
//! typed into a session that was already running, or it caused a fresh Agent
//! Run to be spawned. Status subscribers read the same fact from the attempt
//! projection, so the two never disagree.

/// The delivery a handoff actually received.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeliveryMode {
    /// The handoff was delivered into a live agent session.
    Continued,
    /// A new Agent Run was started to carry the handoff.
    StartedFresh,
}

impl DeliveryMode {
    /// The durable column value. It is the same token the status event and the
    /// public projection publish.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Continued => "continued",
            Self::StartedFresh => "started_fresh",
        }
    }
}

impl std::fmt::Display for DeliveryMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::DeliveryMode;

    #[test]
    fn the_two_deliveries_have_distinct_durable_tokens() {
        assert_eq!(DeliveryMode::Continued.as_str(), "continued");
        assert_eq!(DeliveryMode::StartedFresh.as_str(), "started_fresh");
    }
}
