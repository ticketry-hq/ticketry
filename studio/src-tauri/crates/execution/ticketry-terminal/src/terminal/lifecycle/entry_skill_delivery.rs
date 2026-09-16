//! Typing a bound entry skill into a freshly launched pane.
//!
//! A fresh bound launch carries its composed prompt in the provider's argv, so
//! the only text this stage types is the entry-skill invocation — the provider's
//! own prefix followed by the selected skill, and nothing else. A launch whose
//! pane opened but whose skill never arrived is worse than a launch that never
//! opened, because the agent would silently run without its entry contract. So
//! a failed delivery tears the pane down and reports why.
//!
//! Submission and pane termination arrive as closures. Production passes tmux;
//! the tests pass recorders, which is what makes the delivered text and the
//! teardown observable without a live terminal.

use ticketry_launch::{Provider, TerminalLaunchError, TerminalLaunchErrorCode};

use crate::terminal::prompt_delivery::entry_skill_invocation;
use crate::tmux_adapter::KillOutcome;

/// Types the bound entry skill, tearing the pane down if it does not land.
///
/// `submit` receives the exact text to deliver. `kill` is consulted only when
/// `submit` failed, and its own outcome is named in the returned error so a
/// leaked pane can never be mistaken for a clean teardown.
pub(super) async fn deliver_entry_skill<Submit, Kill>(
    provider: Provider,
    skill: &str,
    submit: Submit,
    kill: Kill,
) -> Result<(), TerminalLaunchError>
where
    Submit: FnOnce(String) -> Result<(), String> + Send + 'static,
    Kill: FnOnce() -> Result<KillOutcome, String>,
{
    let invocation = entry_skill_invocation(provider, skill);
    let delivery = tokio::task::spawn_blocking(move || submit(invocation))
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    let Err(detail) = delivery else {
        return Ok(());
    };
    Err(TerminalLaunchError::new(
        TerminalLaunchErrorCode::PromptDeliveryFailed,
        cleanup_message(kill(), &detail),
    ))
}

fn cleanup_message(cleanup: Result<KillOutcome, String>, detail: &str) -> String {
    match cleanup {
        Ok(KillOutcome::Killed) | Ok(KillOutcome::AlreadyMissing) => format!(
            "Entry skill delivery failed and the terminal pane was terminated: {detail}"
        ),
        Ok(KillOutcome::Refused(observation)) => format!(
            "Entry skill delivery failed; verified pane termination was refused ({observation:?}): {detail}"
        ),
        Err(error) => format!(
            "Entry skill delivery failed and pane termination also failed ({error}): {detail}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tmux_adapter::RuntimeObservation;
    use std::sync::{Arc, Mutex};

    /// Records what the pane was asked to type and whether it was torn down.
    #[derive(Default)]
    struct Recorder {
        typed: Vec<String>,
        kills: usize,
    }

    fn recorder() -> Arc<Mutex<Recorder>> {
        Arc::new(Mutex::new(Recorder::default()))
    }

    fn submitter(
        recorder: &Arc<Mutex<Recorder>>,
        result: Result<(), String>,
    ) -> impl FnOnce(String) -> Result<(), String> + Send + 'static {
        let recorder = Arc::clone(recorder);
        move |text| {
            recorder.lock().unwrap().typed.push(text);
            result
        }
    }

    fn killer(
        recorder: &Arc<Mutex<Recorder>>,
        outcome: Result<KillOutcome, String>,
    ) -> impl FnOnce() -> Result<KillOutcome, String> + '_ {
        move || {
            recorder.lock().unwrap().kills += 1;
            outcome
        }
    }

    /// A fresh bound launch keeps the composed prompt in
    /// provider argv, types only the entry skill with the provider-owned
    /// prefix, and tears down a pane when delivery fails. The teardown half is
    /// covered by the two cases below it.
    #[tokio::test]
    async fn a_bound_launch_types_only_the_provider_formatted_entry_skill() {
        for (provider, expected) in [(Provider::Claude, "/tdd"), (Provider::Codex, "$tdd")] {
            let recorder = recorder();

            deliver_entry_skill(
                provider,
                "tdd",
                submitter(&recorder, Ok(())),
                killer(&recorder, Ok(KillOutcome::Killed)),
            )
            .await
            .expect("delivery succeeds");

            let recorded = recorder.lock().unwrap();
            // Exactly one submission, carrying the invocation and nothing else:
            // the composed prompt travels in argv, never through the keyboard.
            assert_eq!(recorded.typed, vec![expected.to_owned()]);
            // A pane that received its skill is never torn down.
            assert_eq!(recorded.kills, 0);
        }
    }

    #[tokio::test]
    async fn a_failed_delivery_terminates_the_pane_and_reports_the_teardown() {
        let recorder = recorder();

        let error = deliver_entry_skill(
            Provider::Claude,
            "tdd",
            submitter(&recorder, Err("composer never became ready".to_owned())),
            killer(&recorder, Ok(KillOutcome::Killed)),
        )
        .await
        .expect_err("a failed delivery fails the launch");

        assert_eq!(error.code, TerminalLaunchErrorCode::PromptDeliveryFailed);
        assert_eq!(
            error.to_string(),
            "Entry skill delivery failed and the terminal pane was terminated: \
             composer never became ready"
        );
        assert_eq!(recorder.lock().unwrap().kills, 1);
    }

    #[tokio::test]
    async fn a_pane_that_outlives_a_failed_delivery_is_named_as_such() {
        let recorder = recorder();

        let error = deliver_entry_skill(
            Provider::Claude,
            "tdd",
            submitter(&recorder, Err("paste refused".to_owned())),
            killer(
                &recorder,
                Ok(KillOutcome::Refused(RuntimeObservation::Running)),
            ),
        )
        .await
        .expect_err("a failed delivery fails the launch");

        assert_eq!(error.code, TerminalLaunchErrorCode::PromptDeliveryFailed);
        assert_eq!(
            error.to_string(),
            "Entry skill delivery failed; verified pane termination was refused (Running): \
             paste refused"
        );

        let error = deliver_entry_skill(
            Provider::Claude,
            "tdd",
            submitter(&recorder, Err("paste refused".to_owned())),
            killer(&recorder, Err("tmux is gone".to_owned())),
        )
        .await
        .expect_err("a failed delivery fails the launch");

        assert_eq!(
            error.to_string(),
            "Entry skill delivery failed and pane termination also failed (tmux is gone): \
             paste refused"
        );
        assert_eq!(recorder.lock().unwrap().kills, 2);
    }
}
