use crate::common::isolated_tmux::{IsolatedTmux, TmuxEnvironmentOverride, RUN_ID, TMUX_ENV_LOCK};
use std::thread;
use std::time::{Duration, Instant};
use ticketry_launch::Provider;
use ticketry_terminal::{current_runtime_namespace, PromptDelivery, TmuxPromptDelivery};

mod common;

#[test]
fn submits_text_through_a_real_tmux_pane_without_a_viewer() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start_empty();
    server.create_hosted(
        RUN_ID,
        "printf '\u{276f} '; IFS= read -r line; printf '\\nRECEIVED:%s\\n' \"$line\"; sleep 5",
    );
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);
    server.set_session_option(
        RUN_ID,
        "@pt-runtime-namespace",
        &current_runtime_namespace().expect("derive isolated runtime namespace"),
    );
    let tmux = TmuxPromptDelivery::discover().expect("discover isolated tmux");
    let mut delivery = PromptDelivery::new(tmux);

    delivery
        .submit(Provider::Claude, RUN_ID, "hello from typed delivery")
        .expect("deliver text through tmux");

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let pane = server.pane_contents(RUN_ID);
        if pane.contains("RECEIVED:hello from typed delivery") {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "pane did not receive submitted text: {pane:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

/// Handoff always pastes a multi-line destination prompt, so the real-tmux
/// path must be exercised with one. The pane reads two lines rather than one,
/// proving the embedded newline survives the buffer and the paste.
#[test]
fn submits_a_multi_line_payload_through_a_real_tmux_pane() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start_empty();
    server.create_hosted(
        RUN_ID,
        "printf '\u{276f} '; IFS= read -r first; IFS= read -r second; \
         printf '\\nRECEIVED:%s|%s\\n' \"$first\" \"$second\"; sleep 5",
    );
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);
    server.set_session_option(
        RUN_ID,
        "@pt-runtime-namespace",
        &current_runtime_namespace().expect("derive isolated runtime namespace"),
    );
    let tmux = TmuxPromptDelivery::discover().expect("discover isolated tmux");
    let mut delivery = PromptDelivery::new(tmux);

    delivery
        .submit(Provider::Claude, RUN_ID, "first line\nsecond line")
        .expect("deliver multi-line text through tmux");

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let pane = server.pane_contents(RUN_ID);
        if pane.contains("RECEIVED:first line|second line") {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "pane did not receive the multi-line payload: {pane:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}
