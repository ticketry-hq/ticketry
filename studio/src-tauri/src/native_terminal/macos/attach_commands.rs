// First-attachment preparation and pre-presentation frame reconciliation.

#[tauri::command]
pub fn native_terminal_available() -> bool {
    true
}

/// Runs off AppKit's main thread. Preparation waits for a libghostty redraw,
/// and that redraw can only be recorded by a `ghostty_app_tick` dispatched
/// onto the main queue, so blocking the main thread here would deadlock the
/// gate until it timed out. The individual main-thread hops below stay as
/// `run_on_main_thread` round-trips.
#[tauri::command(async)]
pub(crate) fn native_terminal_attach(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    launch: tauri::State<'_, crate::desktop::launch_runtime::DesktopLaunchRuntime>,
    run_id: String,
    viewer_id: String,
    frame: NativeTerminalFrame,
) -> Result<NativeTerminalStatus, String> {
    if window.label() != "main" {
        return Err("native terminals are restricted to the main window".to_owned());
    }
    ensure_preparation_thread()?;
    validate_native_frame(frame)?;
    let reservation = NativeAttachReservation::acquire(&state.entries, &state.attaching, &run_id)?;
    let preparation_phase = Arc::clone(&reservation.phase);

    let handle = new_handle();
    // Geometry published before this attachment belongs to a viewer that
    // never presented; this preparation measures its own frame.
    state.pending_frames.discard(&run_id);
    let attachment =
        TerminalCommandAttachment::prepare(&run_id).map_err(|error| error.to_string())?;
    let command = CString::new(attachment.command())
        .map_err(|_| "direct tmux command contained a NUL byte".to_owned())?;
    let (worker, commands) = mpsc::channel();
    let process_context = Arc::into_raw(Arc::new(worker.clone())) as usize;
    // A viewer that fails during preparation never reached presentation, so
    // it never had the callbacks whose contexts are installed with it.
    let preparation_contexts = NativeViewContexts {
        process: process_context,
        ..NativeViewContexts::default()
    };
    let mut created_view = None;
    let preparation = (|| -> Result<(usize, TerminalGrid), String> {
        let parent = webview_ns_view(&window)?;

        let runtime = ensure_runtime(&window, &state)?;
        let (view_sender, view_receiver) = mpsc::channel();
        let command_bytes = command.into_bytes_with_nul();
        let NativeTerminalFrame {
            x,
            y,
            width,
            height,
            viewport_width,
            viewport_height,
        } = frame;
        let creation_phase = Arc::clone(&preparation_phase);
        window
            .run_on_main_thread(move || {
                let view = if creation_phase.load(Ordering::Acquire) != PREPARING {
                    std::ptr::null_mut()
                } else {
                    unsafe {
                        muxed_ghostty_view_new(
                            runtime as *mut c_void,
                            parent as *mut c_void,
                            command_bytes.as_ptr().cast(),
                            Some(report_process_exit),
                            process_context as *mut c_void,
                        )
                    }
                };
                let size = if view.is_null() {
                    GhosttyGridSize {
                        columns: 0,
                        rows: 0,
                    }
                } else {
                    unsafe {
                        muxed_ghostty_view_set_frame(
                            view,
                            x,
                            y,
                            width,
                            height,
                            viewport_width,
                            viewport_height,
                        )
                    }
                };
                if view_sender.send((view as usize, size)).is_err() && !view.is_null() {
                    unsafe {
                        muxed_ghostty_view_disable_process_exit_callback(view);
                        muxed_ghostty_view_free(view);
                    };
                    release_process_context(process_context);
                }
            })
            .map_err(|error| error.to_string())?;
        let (view, size) = view_receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "timed out creating the native libghostty view".to_owned())?;
        if view == 0 {
            release_process_context(process_context);
            return Err(if preparation_phase.load(Ordering::Acquire) == FAILED {
                "native terminal attachment was cancelled by teardown".to_owned()
            } else {
                "libghostty could not create its native surface".to_owned()
            });
        }
        created_view = Some(view);
        if preparation_phase.load(Ordering::Acquire) == FAILED {
            return Err("native terminal attachment was cancelled by teardown".to_owned());
        }
        let grid = TerminalGrid::new(size.columns, size.rows).map_err(str::to_owned)?;
        Ok((view, grid))
    })();
    let (view, grid) = match preparation {
        Ok(setup) => setup,
        Err(error) => {
            eprintln!("native libghostty attach failed for run {run_id}: {error}");
            if let Some(view) = created_view {
                let _ = free_view(&window, view, preparation_contexts);
            }
            return Err(error);
        }
    };
    // Surface creation launches tmux directly. Adopt the newest published
    // geometry before the hidden viewer is resized and presented.
    let mut grid = grid;
    if let Some(pending) = state.pending_frames.take(&run_id) {
        match apply_frame(&window, view, pending) {
            Ok(reconciled) => grid = reconciled,
            Err(error) => {
                let _ = free_view(&window, view, preparation_contexts);
                return Err(error);
            }
        }
    }
    let mut gate = PreparationGate::default();
    gate.frame_applied(grid);
    let control = attachment.into_control();
    if let Err(error) = control.resize(grid.columns, grid.rows) {
        let _ = free_view(&window, view, preparation_contexts);
        return Err(error.to_string());
    }
    gate.attachment_ready(grid);
    let resize_sender = worker.clone();

    // Redraw at the current grid, then adopt any geometry that arrived
    // while that redraw was in flight. Presentation only happens once the
    // newest published frame has its own redraw, so the first visible
    // pixels carry the pane's real rows and columns.
    let mut reconciliations = 0;
    loop {
        let (redraw_sender, redraw_receiver) = mpsc::channel();
        let redraw_phase = Arc::clone(&preparation_phase);
        window
            .run_on_main_thread(move || {
                let generation = if redraw_phase.load(Ordering::Acquire) == PREPARING {
                    unsafe { muxed_ghostty_view_arm_redraw(view as *mut c_void) }
                } else {
                    u64::MAX
                };
                let _ = redraw_sender.send(generation);
            })
            .map_err(|error| {
                preparation_phase.store(FAILED, Ordering::Release);
                let _ = free_view(&window, view, preparation_contexts);
                error.to_string()
            })?;
        let generation = redraw_receiver
            .recv_timeout(PREPARATION_TIMEOUT)
            .map_err(|_| {
                preparation_phase.store(FAILED, Ordering::Release);
                let _ = free_view(&window, view, preparation_contexts);
                "timed out requesting the first native terminal redraw".to_owned()
            })?;
        if preparation_phase.load(Ordering::Acquire) == FAILED {
            gate.claim_cleanup();
            let _ = free_view(&window, view, preparation_contexts);
            return Err("native terminal attachment was cancelled by teardown".to_owned());
        }
        if let Err(error) = ensure_preparation_thread() {
            preparation_phase.store(FAILED, Ordering::Release);
            gate.claim_cleanup();
            let _ = free_view(&window, view, preparation_contexts);
            return Err(error);
        }
        let redrawn = unsafe {
            muxed_ghostty_view_wait_for_redraw(
                view as *mut c_void,
                generation,
                PREPARATION_TIMEOUT.as_millis() as u32,
            )
        };
        if !redrawn || preparation_phase.load(Ordering::Acquire) == FAILED {
            preparation_phase.store(FAILED, Ordering::Release);
            gate.claim_cleanup();
            let _ = free_view(&window, view, preparation_contexts);
            return Err(if redrawn {
                "native terminal attachment failed during preparation".to_owned()
            } else {
                "timed out waiting for the first native terminal redraw".to_owned()
            });
        }
        let Some(pending) = state.pending_frames.take(&run_id) else {
            break;
        };
        if reconciliations >= MAX_FRAME_RECONCILIATIONS {
            break;
        }
        reconciliations += 1;
        let reconciled = match apply_frame(&window, view, pending) {
            Ok(reconciled) => reconciled,
            Err(error) => {
                preparation_phase.store(FAILED, Ordering::Release);
                gate.claim_cleanup();
                let _ = free_view(&window, view, preparation_contexts);
                return Err(error);
            }
        };
        if reconciled == grid {
            break;
        }
        grid = reconciled;
        let _ = resize_sender.send(NativeViewerCommand::Resize(grid.columns, grid.rows));
        gate.frame_applied(grid);
        gate.attachment_ready(grid);
    }
    if !gate.redraw_ready(grid) {
        gate.claim_cleanup();
        let _ = free_view(&window, view, preparation_contexts);
        return Err("native terminal preparation did not finish".to_owned());
    }
    let scroll_sink = ScrollGestureSink::new(worker.clone());
    let chord_sink = chord_sink(&window, &handle, &run_id);
    let contexts = NativeViewContexts {
        scroll: Arc::into_raw(Arc::clone(&scroll_sink)) as usize,
        chord: Arc::into_raw(Arc::clone(&chord_sink)) as usize,
        process: process_context,
    };
    if let Err(error) = reservation.insert_entry(
        &state.entries,
        handle.clone(),
        NativeEntry {
            run_id: run_id.clone(),
            view,
            worker: worker.clone(),
            scroll_sink,
            chord_sink,
            contexts,
            visibility: NativeTerminalVisibility::hidden(),
            preparation_phase: Arc::clone(&preparation_phase),
        },
    ) {
        let _ = free_view(&window, view, contexts);
        return Err(error);
    }
    spawn_worker(WorkerSetup {
        control,
        commands,
        window: window.clone(),
        entries: Arc::clone(&state.entries),
        handle: handle.clone(),
        run_id: run_id.clone(),
        preparation_phase: Arc::clone(&preparation_phase),
    });
    // Attachment commits only a prepared, addressable handle. Studio must
    // acquire viewer authority and then use the serialized show command
    // before this native view can become visible or interactive.
    if preparation_phase
        .compare_exchange(PREPARING, PRESENTED, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        gate.claim_cleanup();
        cleanup_entry(&state.entries, &window, &handle);
        return Err("native terminal attachment failed after preparation".to_owned());
    }

    // The prepared viewer is now addressable by handle, so later layout
    // changes travel through the handle-based frame/show paths rather than
    // published preparation geometry.
    state.pending_frames.discard(&run_id);
    let ownership = launch.viewer_ownership()?;
    let lease = crate::viewer_ownership::CreateViewerLease {
        agent_run_id: run_id.clone(),
        viewer_id,
        transport: "native".to_owned(),
    };
    if let Err(error) = ownership.stage_prepared(
        &lease,
        Arc::new(NativePreparedViewerMechanics {
            window: window.clone(),
            entries: Arc::clone(&state.entries),
            handle: handle.clone(),
        }),
    ) {
        let _ = detach_native_handle(&window, &state.entries, &handle);
        return Err(error.to_string());
    }
    if let Ok(output_activity) = launch.output_activity() {
        let observed_run_id = run_id.clone();
        tokio::spawn(async move {
            if let Err(error) = output_activity.observe(&observed_run_id).await {
                eprintln!(
                    "Terminal output observation failed for {observed_run_id}: {error}"
                );
            }
        });
    }
    Ok(NativeTerminalStatus {
        handle,
        run_id,
        columns: grid.columns,
        rows: grid.rows,
    })
}

/// Publishes live pane geometry for a viewer that is still preparing.
///
/// A preparing viewer has no handle yet, so Studio addresses it by run.
/// Preparation applies the newest published frame before returning.
#[tauri::command]
pub fn native_terminal_reconcile_frame(
    state: tauri::State<'_, NativeTerminalState>,
    run_id: String,
    frame: NativeTerminalFrame,
) -> Result<(), String> {
    validate_native_frame(frame)?;
    state.pending_frames.publish(&run_id, frame);
    Ok(())
}
