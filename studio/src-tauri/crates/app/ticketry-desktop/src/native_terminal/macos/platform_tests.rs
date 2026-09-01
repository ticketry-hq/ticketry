// Native bridge and registry tests kept out of the command implementation.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_terminal::scroll::{
        MAX_NATIVE_SCROLL_LINES, SCROLL_DIRECTION_DOWN, SCROLL_DIRECTION_NONE, SCROLL_DIRECTION_UP,
    };
    use ticketry_terminal::TerminalScrollDirection;

    fn normalize(vertical_delta: f64, precise: bool) -> (u8, u16) {
        let intent = unsafe { muxed_ghostty_normalize_scroll(vertical_delta, precise) };
        (intent.direction, intent.lines)
    }

    #[test]
    fn precise_trackpad_pixels_become_bounded_line_counts() {
        assert_eq!(normalize(48.0, true), (SCROLL_DIRECTION_UP, 2));
        assert_eq!(normalize(-72.0, true), (SCROLL_DIRECTION_DOWN, 3));
        // Sub-line gestures still move one line, like the browser viewer.
        assert_eq!(normalize(4.0, true), (SCROLL_DIRECTION_UP, 1));
        assert_eq!(
            normalize(-4800.0, true),
            (SCROLL_DIRECTION_DOWN, MAX_NATIVE_SCROLL_LINES)
        );
    }

    #[test]
    fn mouse_wheel_line_deltas_count_directly() {
        assert_eq!(normalize(1.0, false), (SCROLL_DIRECTION_UP, 1));
        assert_eq!(normalize(-3.0, false), (SCROLL_DIRECTION_DOWN, 3));
        assert_eq!(
            normalize(400.0, false),
            (SCROLL_DIRECTION_UP, MAX_NATIVE_SCROLL_LINES)
        );
    }

    #[test]
    fn gestures_without_a_vertical_component_carry_no_intent() {
        assert_eq!(normalize(0.0, true), (SCROLL_DIRECTION_NONE, 0));
        assert_eq!(normalize(0.0, false), (SCROLL_DIRECTION_NONE, 0));
        assert_eq!(normalize(f64::NAN, true), (SCROLL_DIRECTION_NONE, 0));
    }

    #[test]
    fn a_normalized_gesture_reaches_the_viewer_as_a_scroll_command() {
        let (worker, commands) = mpsc::channel::<NativeViewerCommand>();
        let sink = ScrollGestureSink::new(worker);
        let context = Arc::into_raw(Arc::clone(&sink)) as *mut c_void;

        let (direction, lines) = normalize(-96.0, true);
        unsafe { report_scroll_gesture(context, direction, lines) };

        assert_eq!(
            commands.recv().expect("scroll command"),
            NativeViewerCommand::Scroll(TerminalScrollDirection::Down, 4)
        );
        release_scroll_context(context as usize);
    }

    #[test]
    fn preparation_is_allowed_only_away_from_the_main_thread() {
        // Test bodies run on spawned threads, which is where the attach
        // command's preparation now runs too.
        assert!(!unsafe { muxed_ghostty_host_is_main_thread() });
        assert!(ensure_preparation_thread().is_ok());
        let off_main = thread::spawn(ensure_preparation_thread);
        assert!(off_main.join().unwrap().is_ok());
    }

    // AppKit modifier bits and virtual key codes used by the chord policy.
    const CONTROL: u64 = 1 << 18;
    const OPTION: u64 = 1 << 19;
    const COMMAND: u64 = 1 << 20;
    const SHIFT: u64 = 1 << 17;
    const CAPS_LOCK: u64 = 1 << 16;
    const GRAVE_KEY: u16 = 0x32;
    const ESCAPE_KEY: u16 = 0x35;
    const E_KEY: u16 = 0x0E;
    const NUMBER_KEYS: [u16; 10] = [0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19, 0x1D];

    fn studio_chord(modifier_flags: u64, key_code: u16) -> Option<StudioChord> {
        StudioChord::from_native(unsafe { muxed_ghostty_studio_chord(modifier_flags, key_code) })
    }

    #[test]
    fn control_grave_is_the_panel_toggle_the_view_keeps_from_the_terminal() {
        assert_eq!(
            studio_chord(CONTROL, GRAVE_KEY),
            Some(StudioChord::PanelToggle)
        );
        // A stuck caps lock is not a chord modifier.
        assert_eq!(
            studio_chord(CONTROL | CAPS_LOCK, GRAVE_KEY),
            Some(StudioChord::PanelToggle)
        );

        // Exact modifier match, like the Studio keymap: anything else is
        // ordinary terminal input and still reaches libghostty.
        assert_eq!(studio_chord(CONTROL | SHIFT, GRAVE_KEY), None);
        assert_eq!(studio_chord(CONTROL | OPTION, GRAVE_KEY), None);
        assert_eq!(studio_chord(CONTROL | COMMAND, GRAVE_KEY), None);
        assert_eq!(studio_chord(0, GRAVE_KEY), None);
        assert_eq!(studio_chord(CONTROL, ESCAPE_KEY), None);
    }

    #[test]
    fn command_e_is_the_settings_chord_and_typing_e_is_not() {
        assert_eq!(studio_chord(COMMAND, E_KEY), Some(StudioChord::Settings));
        assert_eq!(
            studio_chord(COMMAND | CAPS_LOCK, E_KEY),
            Some(StudioChord::Settings)
        );

        // Someone typing into the terminal keeps every unmodified letter, and
        // Ctrl+E stays the shell's own end-of-line binding.
        assert_eq!(studio_chord(0, E_KEY), None);
        assert_eq!(studio_chord(SHIFT, E_KEY), None);
        assert_eq!(studio_chord(CONTROL, E_KEY), None);
        assert_eq!(studio_chord(OPTION, E_KEY), None);
        assert_eq!(studio_chord(COMMAND | SHIFT, E_KEY), None);
        assert_eq!(studio_chord(COMMAND | CONTROL, E_KEY), None);
    }

    #[test]
    fn exact_command_escape_reports_body_disengagement() {
        assert_eq!(
            studio_chord(COMMAND, ESCAPE_KEY),
            Some(StudioChord::BodyDisengage)
        );
        assert_eq!(
            studio_chord(COMMAND | CAPS_LOCK, ESCAPE_KEY),
            Some(StudioChord::BodyDisengage)
        );
        assert_eq!(studio_chord(0, ESCAPE_KEY), None);
        assert_eq!(studio_chord(COMMAND | SHIFT, ESCAPE_KEY), None);
        assert_eq!(studio_chord(COMMAND | CONTROL, ESCAPE_KEY), None);
        assert_eq!(studio_chord(COMMAND | OPTION, ESCAPE_KEY), None);
    }

    #[test]
    fn command_number_selects_the_matching_module_position() {
        for (index, key_code) in NUMBER_KEYS.into_iter().enumerate() {
            assert_eq!(
                studio_chord(COMMAND, key_code),
                Some(StudioChord::ModulePosition((index + 1) as u8))
            );
            assert_eq!(studio_chord(0, key_code), None);
            assert_eq!(studio_chord(COMMAND | SHIFT, key_code), None);
        }
    }

    #[test]
    fn a_recognised_chord_reaches_the_chord_sink() {
        let (reported, chords) = mpsc::channel();
        let sink = ChordSink::new(move |chord| {
            let _ = reported.send(chord);
        });
        let context = Arc::into_raw(Arc::clone(&sink)) as *mut c_void;

        unsafe { report_studio_chord(context, 1) };
        unsafe { report_studio_chord(context, 2) };
        unsafe { report_studio_chord(context, 13) };
        unsafe { report_studio_chord(context, 5) };

        assert_eq!(chords.try_recv(), Ok(StudioChord::PanelToggle));
        assert_eq!(chords.try_recv(), Ok(StudioChord::Settings));
        assert_eq!(chords.try_recv(), Ok(StudioChord::BodyDisengage));
        assert_eq!(chords.try_recv(), Ok(StudioChord::ModulePosition(3)));
        release_chord_context(context as usize);
    }

    #[test]
    fn an_unrecognised_chord_code_is_not_reported() {
        let (reported, chords) = mpsc::channel();
        let sink = ChordSink::new(move |chord| {
            let _ = reported.send(chord);
        });
        let context = Arc::into_raw(Arc::clone(&sink)) as *mut c_void;

        unsafe { report_studio_chord(context, 0) };

        assert!(chords.try_recv().is_err());
        release_chord_context(context as usize);
    }

    #[test]
    fn a_chord_from_a_detaching_viewer_is_not_reported() {
        let (reported, chords) = mpsc::channel();
        let sink = ChordSink::new(move |chord| {
            let _ = reported.send(chord);
        });
        let context = Arc::into_raw(Arc::clone(&sink)) as *mut c_void;

        sink.stop_accepting();
        unsafe { report_studio_chord(context, 2) };

        assert!(chords.try_recv().is_err());
        release_chord_context(context as usize);
    }

    #[test]
    fn child_exit_callback_queues_attachment_completion() {
        let (worker, commands) = mpsc::channel::<NativeViewerCommand>();
        let context = Arc::into_raw(Arc::new(worker)) as *mut c_void;

        unsafe { report_process_exit(context, 17) };

        assert_eq!(
            commands.recv().expect("process exit command"),
            NativeViewerCommand::AttachmentExited
        );
        release_process_context(context as usize);
    }

    #[test]
    fn appkit_grid_resize_reaches_the_serialized_viewer_worker() {
        let (worker, commands) = mpsc::channel::<NativeViewerCommand>();
        let context = Arc::into_raw(Arc::new(worker)) as *mut c_void;

        unsafe { report_grid_resize(context, 132, 41) };

        assert_eq!(
            commands.recv().expect("resize command"),
            NativeViewerCommand::Resize(132, 41)
        );
        release_process_context(context as usize);
    }

    #[test]
    fn attachment_completion_removes_only_its_handle_from_the_registry() {
        let entries = Arc::new(Mutex::new(HashMap::new()));
        let (first_worker, _first_commands) = mpsc::channel();
        let (second_worker, _second_commands) = mpsc::channel();
        entries.lock().expect("registry").insert(
            "native-first".to_owned(),
            NativeEntry {
                run_id: "run-first".to_owned(),
                view: 1,
                worker: first_worker.clone(),
                scroll_sink: ScrollGestureSink::new(first_worker),
                chord_sink: ChordSink::new(|_| {}),
                contexts: NativeViewContexts::default(),
                visibility: NativeTerminalVisibility::visible(),
                preparation_phase: Arc::new(AtomicU8::new(PRESENTED)),
            },
        );
        entries.lock().expect("registry").insert(
            "native-second".to_owned(),
            NativeEntry {
                run_id: "run-second".to_owned(),
                view: 2,
                worker: second_worker.clone(),
                scroll_sink: ScrollGestureSink::new(second_worker),
                chord_sink: ChordSink::new(|_| {}),
                contexts: NativeViewContexts::default(),
                visibility: NativeTerminalVisibility::visible(),
                preparation_phase: Arc::new(AtomicU8::new(PRESENTED)),
            },
        );

        let completed = take_native_entry(&entries, "native-first").expect("entry");

        assert_eq!(completed.run_id, "run-first");
        let registry = entries.lock().expect("registry");
        assert!(!registry.contains_key("native-first"));
        assert!(registry.contains_key("native-second"));
    }

    #[test]
    fn visibility_changes_keep_the_native_entry_and_worker_registered() {
        let entries = Arc::new(Mutex::new(HashMap::new()));
        let (worker, commands) = mpsc::channel();
        entries.lock().expect("registry").insert(
            "native-retained".to_owned(),
            NativeEntry {
                run_id: "run-retained".to_owned(),
                view: 7,
                worker: worker.clone(),
                scroll_sink: ScrollGestureSink::new(worker),
                chord_sink: ChordSink::new(|_| {}),
                contexts: NativeViewContexts::default(),
                visibility: NativeTerminalVisibility::visible(),
                preparation_phase: Arc::new(AtomicU8::new(PRESENTED)),
            },
        );

        {
            let mut registry = entries.lock().expect("registry");
            let entry = registry.get_mut("native-retained").expect("entry");
            assert!(entry.visibility.hide(false));
            assert!(!entry.visibility.hide(false));
            assert!(entry.visibility.show_after_frame(120, 36).unwrap());
            assert!(!entry.visibility.show_after_frame(120, 36).unwrap());
            entry
                .worker
                .send(NativeViewerCommand::Resize(120, 36))
                .expect("attachment worker remains registered");
        }

        assert_eq!(entries.lock().expect("registry").len(), 1);
        assert_eq!(
            commands.recv().expect("worker command"),
            NativeViewerCommand::Resize(120, 36)
        );
    }

    #[test]
    fn an_in_flight_attach_reserves_its_run_until_it_finishes() {
        let entries = Arc::new(Mutex::new(HashMap::new()));
        let attaching = Arc::new(Mutex::new(NativeAttachRegistry::default()));

        let reservation = NativeAttachReservation::acquire(&entries, &attaching, "run-one")
            .expect("first attach reserves the run");
        let duplicate = NativeAttachReservation::acquire(&entries, &attaching, "run-one");

        assert_eq!(
            duplicate.err().as_deref(),
            Some("a native viewer is already attached to this run")
        );
        drop(reservation);
        assert!(NativeAttachReservation::acquire(&entries, &attaching, "run-one",).is_ok());
    }

    #[test]
    fn teardown_cancels_in_flight_attach_and_fences_late_insertion() {
        let entries = Arc::new(Mutex::new(HashMap::new()));
        let attaching = Arc::new(Mutex::new(NativeAttachRegistry::default()));
        let reservation = NativeAttachReservation::acquire(&entries, &attaching, "run-one")
            .expect("attach reservation");

        attaching.lock().expect("attachment registry").cancel_all();

        assert_eq!(reservation.phase.load(Ordering::Acquire), FAILED);
        assert!(!reservation.is_current(&attaching.lock().expect("attachment registry")));
        let (worker, _commands) = mpsc::channel();
        let insertion = reservation.insert_entry(
            &entries,
            "native-late".to_owned(),
            NativeEntry {
                run_id: "run-one".to_owned(),
                view: 0,
                worker: worker.clone(),
                scroll_sink: ScrollGestureSink::new(worker),
                chord_sink: ChordSink::new(|_| {}),
                contexts: NativeViewContexts::default(),
                visibility: NativeTerminalVisibility::hidden(),
                preparation_phase: Arc::clone(&reservation.phase),
            },
        );
        assert_eq!(
            insertion.err().as_deref(),
            Some("native terminal attachment was cancelled by teardown")
        );
        assert!(entries.lock().expect("registry").is_empty());
    }
}
