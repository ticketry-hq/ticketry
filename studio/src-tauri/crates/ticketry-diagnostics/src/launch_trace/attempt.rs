//! The launch attempt identity every pre-commit record is keyed by.
//!
//! The earliest stages run before an Agent Run exists, so the trace cannot key
//! on one there. Each attempt is assigned an identity at the requesting
//! surface; the commit records that identity together with the Agent Run it
//! produced, and the reader joins the halves on that pairing.

use std::sync::{Arc, Mutex};

use super::surface::LaunchSurface;

/// What the trace knows about an attempt so far.
///
/// Facts accumulate: the requested provider may be unknown until authority
/// resolves it, and every later stage should still record it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AttemptFacts {
    pub project_id: Option<String>,
    pub work_item_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub scope: Option<String>,
}

/// One launch attempt, from the request through to its Agent Run.
#[derive(Clone, Debug)]
pub struct LaunchAttempt {
    id: String,
    surface: LaunchSurface,
    facts: Arc<Mutex<AttemptFacts>>,
}

impl LaunchAttempt {
    /// Begins an attempt at the surface that asked for the launch.
    pub fn beginning_at(surface: LaunchSurface) -> Self {
        Self {
            id: uuid::Uuid::new_v4().simple().to_string(),
            surface,
            facts: Arc::new(Mutex::new(AttemptFacts::default())),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn surface(&self) -> LaunchSurface {
        self.surface
    }

    /// Reads the facts known so far. A poisoned lock reports what it can
    /// rather than failing a launch it only observes.
    pub fn facts(&self) -> AttemptFacts {
        match self.facts.lock() {
            Ok(facts) => facts.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Records a fact the trace did not know yet. Established facts are never
    /// overwritten with nothing.
    pub fn note(&self, update: impl FnOnce(&mut AttemptFacts)) {
        let mut facts = match self.facts.lock() {
            Ok(facts) => facts,
            Err(poisoned) => poisoned.into_inner(),
        };
        update(&mut facts);
    }
}

tokio::task_local! {
    static CURRENT_ATTEMPT: LaunchAttempt;
}

/// Runs `work` with `attempt` as the current attempt.
pub async fn within<Work>(attempt: LaunchAttempt, work: Work) -> Work::Output
where
    Work: std::future::Future,
{
    CURRENT_ATTEMPT.scope(attempt, work).await
}

/// Runs `work` as a launch requested by `surface`, beginning a new attempt.
///
/// Requesting surfaces wrap their launch call in this so the attempt identity
/// and the surface are established before anything else happens.
pub async fn requested_by<Work>(surface: LaunchSurface, work: Work) -> Work::Output
where
    Work: std::future::Future,
{
    within(LaunchAttempt::beginning_at(surface), work).await
}

/// The attempt this task is launching under, when there is one.
pub fn current() -> Option<LaunchAttempt> {
    CURRENT_ATTEMPT.try_with(Clone::clone).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_attempt_is_visible_to_the_work_it_scopes() {
        let observed = requested_by(LaunchSurface::RunNow, async {
            let attempt = current().expect("an attempt inside the scope");
            attempt.note(|facts| facts.provider = Some("claude".to_owned()));
            (attempt.id().to_owned(), attempt.surface(), nested().await)
        })
        .await;

        assert!(!observed.0.is_empty());
        assert_eq!(observed.1, LaunchSurface::RunNow);
        assert_eq!(observed.2.as_deref(), Some("claude"));
        assert!(
            current().is_none(),
            "the attempt must not outlive the launch it scopes"
        );
    }

    async fn nested() -> Option<String> {
        current().and_then(|attempt| attempt.facts().provider)
    }

    #[tokio::test]
    async fn attempts_have_distinct_identities() {
        let first = LaunchAttempt::beginning_at(LaunchSurface::LaunchPicker);
        let second = LaunchAttempt::beginning_at(LaunchSurface::LaunchPicker);
        assert_ne!(first.id(), second.id());
    }
}
