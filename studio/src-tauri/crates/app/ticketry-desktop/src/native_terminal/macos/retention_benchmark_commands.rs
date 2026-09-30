// Packaged acceptance-only provisioning for CODING-1393 retention measurements.

use crate::native_terminal::retention_benchmark::{
    retention_benchmark_enabled, validate_retention_benchmark_request,
    NativeRetentionBenchmarkStatus,
};

const RETENTION_BENCHMARK_COMMAND: &[u8] = b"/bin/cat\0";

#[tauri::command]
pub fn native_terminal_retention_benchmark(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    count: u16,
    frame: NativeTerminalFrame,
) -> Result<NativeRetentionBenchmarkStatus, String> {
    validate_retention_benchmark_request(retention_benchmark_enabled(), count)
        .map_err(str::to_owned)?;
    if window.label() != "main" {
        return Err("native retention benchmark is restricted to the main window".to_owned());
    }
    if !state
        .entries
        .lock()
        .expect("native terminal registry poisoned")
        .is_empty()
    {
        return Err(
            "native retention benchmark requires an empty product viewer registry".to_owned(),
        );
    }

    if count == 0 {
        let views = std::mem::take(
            &mut *state
                .retention_benchmark_views
                .lock()
                .expect("native retention benchmark registry poisoned"),
        );
        let pending_views = Arc::new(Mutex::new(Some(views)));
        let callback_views = Arc::clone(&pending_views);
        let (sender, receiver) = mpsc::channel();
        if let Err(error) = window.run_on_main_thread(move || {
            let views = callback_views
                .lock()
                .expect("native retention benchmark disposal poisoned")
                .take()
                .unwrap_or_default();
            for view in views {
                unsafe { muxed_ghostty_view_free(view as *mut c_void) };
            }
            let _ = sender.send(());
        }) {
            if let Some(views) = pending_views
                .lock()
                .expect("native retention benchmark disposal poisoned")
                .take()
            {
                *state
                    .retention_benchmark_views
                    .lock()
                    .expect("native retention benchmark registry poisoned") = views;
            }
            return Err(error.to_string());
        }
        receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "timed out disposing native retention benchmark views".to_owned())?;
        return Ok(NativeRetentionBenchmarkStatus {
            requested_count: 0,
            created_count: 0,
            visible_count: 0,
            selected_count: 0,
            hidden_count: 0,
        });
    }

    validate_native_frame(frame)?;
    if !state
        .retention_benchmark_views
        .lock()
        .expect("native retention benchmark registry poisoned")
        .is_empty()
    {
        return Err(
            "dispose the existing native retention benchmark before provisioning another"
                .to_owned(),
        );
    }
    let parent = webview_ns_view(&window)?;
    let runtime = ensure_runtime(&window, &state)?;
    let NativeTerminalFrame {
        x,
        y,
        width,
        height,
        viewport_width,
        viewport_height,
    } = frame;
    let (sender, receiver) = mpsc::channel();
    window
        .run_on_main_thread(move || {
            let mut views = Vec::with_capacity(usize::from(count));
            let result = (|| -> Result<NativeRetentionBenchmarkStatus, String> {
                for _ in 0..count {
                    let view = unsafe {
                        muxed_ghostty_view_new(
                            runtime as *mut c_void,
                            parent as *mut c_void,
                            RETENTION_BENCHMARK_COMMAND.as_ptr().cast(),
                            None,
                            std::ptr::null_mut(),
                        )
                    };
                    if view.is_null() {
                        return Err(
                            "libghostty could not create a retention benchmark view".to_owned()
                        );
                    }
                    views.push(view as usize);
                    let size = unsafe {
                        muxed_ghostty_view_set_frame(
                            view,
                            x,
                            y,
                            width,
                            height,
                            viewport_width,
                            viewport_height,
                        )
                    };
                    if size.columns == 0 || size.rows == 0 {
                        return Err(
                            "libghostty could not size a retention benchmark view".to_owned()
                        );
                    }
                    unsafe { muxed_ghostty_view_hide(view) };
                }

                let selected = views[0] as *mut c_void;
                let shown = unsafe {
                    muxed_ghostty_view_show(
                        selected,
                        x,
                        y,
                        width,
                        height,
                        viewport_width,
                        viewport_height,
                    )
                };
                if shown.columns == 0
                    || shown.rows == 0
                    || !unsafe { muxed_ghostty_view_set_webview_interaction(selected, false) }
                {
                    return Err(
                        "libghostty could not select the retention benchmark view".to_owned()
                    );
                }

                let visible_count = views
                    .iter()
                    .filter(|view| !unsafe { muxed_ghostty_view_is_hidden(**view as *mut c_void) })
                    .count() as u16;
                let selected_count = views
                    .iter()
                    .filter(|view| unsafe {
                        muxed_ghostty_view_accepts_input(**view as *mut c_void)
                    })
                    .count() as u16;
                let status = NativeRetentionBenchmarkStatus {
                    requested_count: count,
                    created_count: views.len() as u16,
                    visible_count,
                    selected_count,
                    hidden_count: count.saturating_sub(visible_count),
                };
                if status.created_count != count
                    || status.visible_count != 1
                    || status.selected_count != 1
                    || status.hidden_count != count - 1
                {
                    return Err(format!(
                        "native retention benchmark verification failed: {status:?}"
                    ));
                }
                Ok(status)
            })();
            if result.is_err() {
                for view in views.drain(..) {
                    unsafe { muxed_ghostty_view_free(view as *mut c_void) };
                }
            }
            if let Err(undelivered) = sender.send((result, views)) {
                let (_, undelivered_views) = undelivered.0;
                for view in undelivered_views {
                    unsafe { muxed_ghostty_view_free(view as *mut c_void) };
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let (status, views) = receiver
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "timed out provisioning native retention benchmark views".to_owned())?;
    let status = status?;
    *state
        .retention_benchmark_views
        .lock()
        .expect("native retention benchmark registry poisoned") = views;
    Ok(status)
}
