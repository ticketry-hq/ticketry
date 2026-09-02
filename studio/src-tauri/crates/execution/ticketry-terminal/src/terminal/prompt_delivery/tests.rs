use super::*;
use std::collections::VecDeque;
use std::path::Path;
use std::time::Duration;
use ticketry_launch::{provider_contract, Provider};

#[derive(Default)]
struct FakeTmux {
    screens: VecDeque<Vec<u8>>,
    calls: Vec<&'static str>,
    loaded: Vec<u8>,
    fail_paste: bool,
}

impl PromptDeliveryTmux for FakeTmux {
    fn verify_session(&mut self, _: &str) -> Result<(), String> {
        self.calls.push("verify-session");
        Ok(())
    }

    fn capture_screen(&mut self, _: &str) -> Result<Vec<u8>, String> {
        self.calls.push("capture-pane");
        Ok(self.screens.pop_front().unwrap_or_default())
    }

    fn set_buffer(&mut self, _: &str, _: &str, _: &str) -> Result<(), String> {
        self.calls.push("set-buffer");
        Ok(())
    }

    fn load_buffer(&mut self, _: &str, _: &str, path: &Path) -> Result<(), String> {
        self.calls.push("load-buffer");
        self.loaded = std::fs::read(path).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn paste_buffer(&mut self, _: &str, _: &str) -> Result<(), String> {
        self.calls.push("paste-buffer");
        if self.fail_paste {
            Err("injected paste failure".into())
        } else {
            Ok(())
        }
    }

    fn send_enter(&mut self, _: &str) -> Result<(), String> {
        self.calls.push("send-keys Enter");
        Ok(())
    }
}

fn timings() -> DeliveryTimings {
    DeliveryTimings {
        readiness_timeout: Duration::from_secs(1),
        readiness_poll: Duration::ZERO,
        visibility_timeout: Duration::from_secs(1),
        visibility_poll: Duration::ZERO,
        paste_settle: Duration::ZERO,
        completion_settle: Duration::ZERO,
    }
}

#[test]
fn stage_waits_for_readiness_and_sends_no_keys() {
    let fake = FakeTmux {
        screens: [
            b"provider booting".to_vec(),
            "\x1b[32m\u{276f}\x1b[0m ".as_bytes().to_vec(),
            "\u{276f} continue".as_bytes().to_vec(),
        ]
        .into(),
        ..Default::default()
    };
    let mut delivery = PromptDelivery::with_timings(fake, timings());

    delivery.stage(Provider::Claude, "run", "continue").unwrap();

    assert_eq!(
        delivery.tmux().calls,
        [
            "verify-session",
            "capture-pane",
            "capture-pane",
            "set-buffer",
            "paste-buffer",
            "capture-pane"
        ]
    );
    assert!(!delivery
        .tmux()
        .calls
        .iter()
        .any(|call| call.contains("send-keys")));
}

#[test]
fn submit_verifies_visibility_then_presses_enter_twice() {
    let fake = FakeTmux {
        screens: [
            "\u{203a} Ask Codex to do anything".as_bytes().to_vec(),
            "\u{203a} $implement story context".as_bytes().to_vec(),
        ]
        .into(),
        ..Default::default()
    };
    let mut delivery = PromptDelivery::with_timings(fake, timings());

    delivery
        .submit(Provider::Codex, "run", "$implement story\ncontext")
        .unwrap();

    assert_eq!(
        delivery.tmux().calls,
        [
            "verify-session",
            "capture-pane",
            "set-buffer",
            "paste-buffer",
            "capture-pane",
            "send-keys Enter",
            "send-keys Enter"
        ]
    );
}

#[test]
fn never_ready_pane_returns_readiness_timeout() {
    let mut timeout = timings();
    timeout.readiness_timeout = Duration::ZERO;
    let fake = FakeTmux {
        screens: [b"provider booting".to_vec()].into(),
        ..Default::default()
    };
    let mut delivery = PromptDelivery::with_timings(fake, timeout);

    let error = delivery
        .stage(Provider::Claude, "run", "continue")
        .unwrap_err();

    assert_eq!(
        error.reason(),
        PromptDeliveryFailureReason::ReadinessTimeout
    );
}

#[test]
fn provider_without_marker_is_refused_before_tmux_is_called() {
    let fake = FakeTmux::default();
    let mut delivery = PromptDelivery::with_timings(fake, timings());
    let mut contract = provider_contract(Provider::Claude);
    contract.ready_composer_marker = None;

    let error = delivery
        .stage_contract(contract, "run", "continue")
        .unwrap_err();

    assert_eq!(
        error.reason(),
        PromptDeliveryFailureReason::ReadinessMarkerMissing
    );
    assert!(delivery.tmux().calls.is_empty());
}

#[test]
fn paste_failure_has_a_typed_reason() {
    let fake = FakeTmux {
        screens: ["\u{276f} ".as_bytes().to_vec()].into(),
        fail_paste: true,
        ..Default::default()
    };
    let mut delivery = PromptDelivery::with_timings(fake, timings());

    let error = delivery
        .stage(Provider::Claude, "run", "continue")
        .unwrap_err();

    assert_eq!(error.reason(), PromptDeliveryFailureReason::PasteFailed);
}

#[test]
fn invisible_paste_is_not_submitted() {
    let mut timeout = timings();
    timeout.visibility_timeout = Duration::ZERO;
    let fake = FakeTmux {
        screens: ["\u{276f} ".as_bytes().to_vec(), b"not rendered".to_vec()].into(),
        ..Default::default()
    };
    let mut delivery = PromptDelivery::with_timings(fake, timeout);

    let error = delivery
        .submit(Provider::Claude, "run", "continue")
        .unwrap_err();

    assert_eq!(
        error.reason(),
        PromptDeliveryFailureReason::VisibilityTimeout
    );
    assert!(!delivery
        .tmux()
        .calls
        .iter()
        .any(|call| call.contains("send-keys")));
}

#[test]
fn default_submission_delays_match_the_delivery_contract() {
    let defaults = DeliveryTimings::default();
    assert_eq!(defaults.paste_settle, Duration::from_millis(150));
    assert_eq!(defaults.completion_settle, Duration::from_millis(50));
}

#[test]
fn handoff_readiness_waits_longer_than_fresh_delivery_and_accepts_an_override() {
    let fresh = DeliveryTimings::default();
    let handoff = DeliveryTimings::handoff(None);
    let configured = DeliveryTimings::handoff(Some(Duration::from_secs(180)));

    assert!(handoff.readiness_timeout > fresh.readiness_timeout);
    assert_eq!(configured.readiness_timeout, Duration::from_secs(180));
}

#[test]
fn entry_skill_invocation_uses_the_provider_prefix_and_only_the_selected_skill() {
    assert_eq!(entry_skill_invocation(Provider::Codex, "tdd"), "$tdd");
    assert_eq!(entry_skill_invocation(Provider::Claude, "tdd"), "/tdd");
}

#[test]
fn large_payload_uses_a_file_backed_buffer_intact() {
    let prompt = "large prompt line\n".repeat(1_000);
    let fake = FakeTmux {
        screens: ["\u{276f} ".as_bytes().to_vec(), prompt.as_bytes().to_vec()].into(),
        ..Default::default()
    };
    let mut delivery = PromptDelivery::with_timings(fake, timings());

    delivery.stage(Provider::Claude, "run", &prompt).unwrap();

    assert_eq!(delivery.tmux().loaded, prompt.as_bytes());
    assert!(delivery.tmux().calls.contains(&"load-buffer"));
    assert!(!delivery.tmux().calls.contains(&"set-buffer"));
}
