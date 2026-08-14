use crate::common::isolated_tmux::{IsolatedTmux, TmuxEnvironmentOverride, RUN_ID, TMUX_ENV_LOCK};
use muxed_studio_lib::terminal_runtime::{
    AttachmentOutcome, TerminalAttachment, TerminalAttachmentError, TerminalScrollDirection,
};
use std::io::Read;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

mod common;

#[test]
fn attaches_exchanges_input_resizes_and_detaches_without_killing_the_session() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);

    let viewer = TerminalAttachment::attach(RUN_ID, 91, 27).expect("attach terminal");
    let (mut viewer, mut reader) = viewer.into_control_and_reader();
    assert_eq!(server.window_size(), "91x27");
    assert_eq!(viewer.poll_exit().expect("poll attached client"), None);

    viewer.resize(120, 40).expect("resize viewer PTY");
    assert_eq!(server.window_size(), "120x40");
    assert_eq!(viewer.poll_exit().expect("poll resized client"), None);

    viewer
        .write_all(b"printf 'MUXED_PTY_OK\\n'\\r")
        .expect("write deterministic input");

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let viewer = viewer;
        let mut output = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(read) => {
                    output.extend_from_slice(&buffer[..read]);
                    if output
                        .windows(b"MUXED_PTY_OK".len())
                        .any(|bytes| bytes == b"MUXED_PTY_OK")
                    {
                        sender.send(Ok((viewer, output))).expect("return viewer");
                        return;
                    }
                }
                Err(error) => {
                    sender
                        .send(Err(error.to_string()))
                        .expect("return read error");
                    return;
                }
            }
        }
    });
    let (viewer, output) = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("tmux produced deterministic output")
        .expect("PTY did not close before output");
    assert!(String::from_utf8_lossy(&output).contains("MUXED_PTY_OK"));
    assert_eq!(
        viewer.detach().expect("detach viewer"),
        AttachmentOutcome::Detached
    );
    assert!(
        server.has_session(),
        "detach must not kill the durable tmux session"
    );
}

#[test]
fn reports_a_missing_session_as_a_typed_error() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);

    let error = match TerminalAttachment::attach("missing-run", 80, 24) {
        Err(error) => error,
        Ok(_) => panic!("missing session must fail"),
    };
    assert!(matches!(
        error,
        TerminalAttachmentError::SessionNotFound { .. }
    ));
}

#[test]
fn scrolls_copy_mode_history_back_to_the_live_prompt_without_ending_the_session() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);
    let viewer = TerminalAttachment::attach(RUN_ID, 80, 12).expect("attach terminal");
    let (mut viewer, mut reader) = viewer.into_control_and_reader();
    let (output_sender, output_receiver) = mpsc::channel();
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(read) => {
                    if output_sender.send(buffer[..read].to_vec()).is_err() {
                        return;
                    }
                }
            }
        }
    });

    viewer
        .write_all(
            b"i=1; while [ $i -le 80 ]; do printf 'SCROLL_%03d\\n' \"$i\"; i=$((i+1)); done\r",
        )
        .expect("populate deterministic scrollback");
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while server
        .pane_value("#{history_size}")
        .parse::<usize>()
        .expect("numeric tmux history size")
        < 40
    {
        assert!(
            std::time::Instant::now() < deadline,
            "tmux did not populate scrollback"
        );
        thread::sleep(Duration::from_millis(20));
    }

    const MARKER: &[u8] = b"POSMARK";
    server.set_window_option(
        "copy-mode-position-format",
        std::str::from_utf8(MARKER).expect("ASCII marker"),
    );
    while output_receiver.try_recv().is_ok() {}

    viewer
        .scroll(TerminalScrollDirection::Up, 6)
        .expect("scroll upward");
    assert_eq!(server.pane_value("#{pane_in_mode}"), "1");
    assert!(
        server
            .pane_value("#{scroll_position}")
            .parse::<usize>()
            .expect("numeric scroll position")
            >= 6
    );
    let output_deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut rendered = Vec::new();
    while std::time::Instant::now() < output_deadline {
        match output_receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => rendered.extend_from_slice(&chunk),
            Err(mpsc::RecvTimeoutError::Timeout) if !rendered.is_empty() => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    assert!(
        rendered
            .windows(b"SCROLL_".len())
            .any(|bytes| bytes == b"SCROLL_"),
        "copy-mode should redraw terminal history"
    );
    assert!(
        !rendered.windows(MARKER.len()).any(|bytes| bytes == MARKER),
        "copy-mode position marker must be hidden"
    );

    viewer
        .scroll(TerminalScrollDirection::Down, 500)
        .expect("scroll to live prompt");
    assert_eq!(server.pane_value("#{pane_in_mode}"), "0");
    assert_eq!(server.global_option("mouse"), "off");
    assert!(
        server.has_session(),
        "scrolling must preserve the durable session"
    );

    assert_eq!(
        viewer.detach().expect("detach scrolled viewer"),
        AttachmentOutcome::Detached
    );
    reader_thread.join().expect("join viewer output reader");
    assert!(
        server.has_session(),
        "detach must preserve the durable session"
    );
}
