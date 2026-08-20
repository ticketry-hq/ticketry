//! Native wheel gestures move the Durable terminal session through the
//! Scroll bridge, observed at the native worker boundary against an isolated
//! tmux server.

use crate::common::isolated_tmux::{IsolatedTmux, TmuxEnvironmentOverride, RUN_ID, TMUX_ENV_LOCK};
use muxed_studio_lib::native_terminal_scroll::{
    ScrollGestureSink, MAX_NATIVE_SCROLL_LINES, SCROLL_DIRECTION_DOWN, SCROLL_DIRECTION_UP,
};
use muxed_studio_lib::native_terminal_worker::{
    run_native_worker, NativeViewerCommand, NativeWorkerExit,
};
use muxed_studio_lib::terminal_runtime::{TerminalAttachment, TerminalCommandAttachment};
use std::io::Read;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

mod common;

const MARKER: &[u8] = b"POSMARK";

#[test]
fn native_gestures_enter_history_and_return_to_the_live_prompt() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);

    let observer = TerminalAttachment::attach(RUN_ID, 80, 12).expect("attach output observer");
    let (mut observer, mut reader) = observer.into_control_and_reader();
    let direct = TerminalCommandAttachment::prepare(RUN_ID).expect("prepare direct viewer");
    let control = direct.into_control();
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

    // Every viewer control for this attachment is serialized through the one
    // native worker channel that gestures also use.
    let (commands, command_receiver) = mpsc::channel();
    let worker = thread::spawn(move || run_native_worker(control, &command_receiver));
    let sink = ScrollGestureSink::new(commands.clone());

    observer
        .write_all(
            b"i=1; while [ $i -le 80 ]; do printf 'SCROLL_%03d\\n' \"$i\"; i=$((i+1)); done\r",
        )
        .expect("write deterministic scrollback input");
    let deadline = Instant::now() + Duration::from_secs(5);
    while server
        .pane_value("#{history_size}")
        .parse::<usize>()
        .expect("numeric tmux history size")
        < 40
    {
        assert!(
            Instant::now() < deadline,
            "tmux did not populate scrollback"
        );
        thread::sleep(Duration::from_millis(20));
    }

    commands
        .send(NativeViewerCommand::Resize(80, 14))
        .expect("queue a resize alongside gestures");
    server.set_window_option(
        "copy-mode-position-format",
        std::str::from_utf8(MARKER).expect("ASCII marker"),
    );
    while output_receiver.try_recv().is_ok() {}

    assert!(
        sink.accept(SCROLL_DIRECTION_UP, 6),
        "an upward gesture is accepted while the viewer is attached"
    );
    await_pane_value(&server, "#{pane_in_mode}", "1");
    await_positive_pane_value(&server, "#{scroll_position}");

    let rendered = collect_output(&output_receiver);
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

    assert!(
        sink.accept(SCROLL_DIRECTION_DOWN, MAX_NATIVE_SCROLL_LINES),
        "a downward gesture is accepted while the viewer is attached"
    );
    await_pane_value(&server, "#{pane_in_mode}", "0");
    assert_eq!(
        server.global_option("mouse"),
        "off",
        "gestures must not enable tmux mouse mode"
    );
    assert!(
        server.has_session(),
        "scrolling must preserve the durable session"
    );

    // Viewer detachment stops accepting gestures before the view is removed.
    sink.stop_accepting();
    assert!(!sink.accept(SCROLL_DIRECTION_UP, 6));
    commands
        .send(NativeViewerCommand::Detach)
        .expect("queue viewer detachment");
    assert_eq!(
        worker.join().expect("join native worker"),
        NativeWorkerExit::Detached
    );
    assert_eq!(server.pane_value("#{pane_in_mode}"), "0");
    assert!(
        server.has_session(),
        "detach must preserve the durable session"
    );
    observer.detach().expect("detach output observer");
    drop(output_receiver);
    reader_thread.join().expect("join viewer output reader");
}

#[test]
fn a_replaced_viewers_late_gesture_cannot_scroll_its_replacement() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);

    let replaced = TerminalCommandAttachment::prepare(RUN_ID).expect("prepare the first viewer");
    let replaced_control = replaced.into_control();
    let (replaced_commands, replaced_receiver) = mpsc::channel();
    let replaced_sink = ScrollGestureSink::new(replaced_commands.clone());
    let replaced_worker =
        thread::spawn(move || run_native_worker(replaced_control, &replaced_receiver));

    replaced_sink.stop_accepting();
    replaced_commands
        .send(NativeViewerCommand::Detach)
        .expect("detach the first viewer");
    assert_eq!(
        replaced_worker.join().expect("join the first worker"),
        NativeWorkerExit::Detached
    );
    let replacement =
        TerminalCommandAttachment::prepare(RUN_ID).expect("prepare the replacement viewer");
    let replacement_control = replacement.into_control();
    let (replacement_commands, replacement_receiver) = mpsc::channel();
    let replacement_worker =
        thread::spawn(move || run_native_worker(replacement_control, &replacement_receiver));

    // A gesture from the replaced viewer arrives after its replacement is live.
    assert!(!replaced_sink.accept(SCROLL_DIRECTION_UP, 6));
    thread::sleep(Duration::from_millis(200));
    assert_eq!(
        server.pane_value("#{pane_in_mode}"),
        "0",
        "a late gesture must not scroll the replacement viewer"
    );

    replacement_commands
        .send(NativeViewerCommand::Detach)
        .expect("detach the replacement viewer");
    assert_eq!(
        replacement_worker.join().expect("join the replacement"),
        NativeWorkerExit::Detached
    );
    assert!(server.has_session());
}

fn await_pane_value(server: &IsolatedTmux, format: &str, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let value = server.pane_value(format);
        if value == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "tmux {format} stayed {value:?} instead of {expected:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn await_positive_pane_value(server: &IsolatedTmux, format: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let value = server.pane_value(format);
        if value
            .parse::<usize>()
            .expect("numeric tmux pane value")
            > 0
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "tmux {format} stayed {value:?} instead of becoming positive"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn collect_output(output: &mpsc::Receiver<Vec<u8>>) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut rendered = Vec::new();
    while Instant::now() < deadline {
        match output.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => rendered.extend_from_slice(&chunk),
            Err(mpsc::RecvTimeoutError::Timeout) if !rendered.is_empty() => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    rendered
}
