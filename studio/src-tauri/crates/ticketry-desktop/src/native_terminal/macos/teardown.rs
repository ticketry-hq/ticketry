// Viewer teardown: what a page reload and an application exit each free, and
// when those frees are allowed to touch AppKit.

/// One native free, handed to whoever owns when it may run.
type NativeFree = Box<dyn FnOnce() + Send>;

/// When the native frees for a teardown are allowed to run.
enum NativeTeardownTiming<'a> {
    /// Frees are collected and dispatched together on a later main-thread
    /// turn. Page reload teardown runs inside WebKit's `didCommitNavigation`
    /// callback, where WebKit is still committing the new document's frame and
    /// layer tree. Freeing a Ghostty surface there tears a Metal layer and an
    /// `NSView` out of the WKWebView mid-commit, and that reentrancy crashed
    /// the process with an `EXC_BAD_ACCESS` no Rust panic could attribute
    /// (CODING-1368 investigation). Deferring puts the frees on the same seam
    /// every other detach path already uses.
    Deferred(&'a mut Vec<NativeFree>),
    /// Frees complete before the call returns. Application shutdown has no
    /// later main-thread turn to defer to: the process leaves through it.
    Immediate,
}

/// Disables every callback a native view can emit through, frees the view,
/// then releases the contexts those callbacks read. The order is the contract:
/// each context outlives every event its view could still emit.
///
/// Must run on AppKit's main thread.
unsafe fn free_view_and_contexts(view: usize, contexts: NativeViewContexts) {
    muxed_ghostty_view_disable_scroll_callback(view as *mut c_void);
    muxed_ghostty_view_disable_chord_callback(view as *mut c_void);
    muxed_ghostty_view_disable_resize_callback(view as *mut c_void);
    muxed_ghostty_view_disable_process_exit_callback(view as *mut c_void);
    muxed_ghostty_view_free(view as *mut c_void);
    release_view_contexts(contexts);
}

impl NativeTerminalState {
    /// Application exit and window close detach every native viewer, freeing
    /// before returning because no later main-thread turn will run.
    pub fn detach_all(&self) {
        self.detach_every_viewer(NativeTeardownTiming::Immediate);
    }

    /// A page reload detaches every native viewer so a stale surface cannot
    /// cover the freshly loaded Studio layout. The registry is drained and
    /// every viewer stops accepting events before this returns; only the
    /// native frees wait for the navigation callback to unwind.
    pub fn detach_all_for_page_load(&self, application: &tauri::AppHandle) {
        let mut frees = Vec::new();
        self.detach_every_viewer(NativeTeardownTiming::Deferred(&mut frees));
        defer_native_frees(application, frees);
    }

    fn detach_every_viewer(&self, mut timing: NativeTeardownTiming<'_>) {
        self.ordering
            .lock()
            .expect("native terminal ordering poisoned")
            .reset();
        #[cfg(feature = "desktop-acceptance")]
        for view in self
            .retention_benchmark_views
            .lock()
            .expect("native retention benchmark registry poisoned")
            .drain(..)
        {
            free_view_with_timing(&mut timing, view, NativeViewContexts::default());
        }
        let (entries, has_in_flight_attachments) = {
            let mut attaching = self
                .attaching
                .lock()
                .expect("native terminal attachment registry poisoned");
            attaching.cancel_all();
            let mut registry = self
                .entries
                .lock()
                .expect("native terminal registry poisoned");
            (
                registry.drain().map(|(_, entry)| entry).collect::<Vec<_>>(),
                !attaching.runs.is_empty(),
            )
        };
        for entry in entries {
            entry.preparation_phase.store(FAILED, Ordering::Release);
            entry.stop_accepting_events();
            free_view_with_timing(&mut timing, entry.view, entry.contexts);
            let _ = entry.worker.send(NativeViewerCommand::Detach);
        }
        // A cancelled preparation may still be unwinding a main-thread
        // libghostty operation. Keep the shared runtime alive until a later
        // teardown rather than freeing it underneath that operation.
        if has_in_flight_attachments {
            return;
        }
        let Some(runtime) = self
            .runtime
            .lock()
            .expect("ghostty runtime poisoned")
            .take()
        else {
            return;
        };
        // Queued after every view above, so the shared app outlives the
        // surfaces that belong to it.
        free_runtime_with_timing(&mut timing, runtime);
    }
}

fn free_view_with_timing(
    timing: &mut NativeTeardownTiming<'_>,
    view: usize,
    contexts: NativeViewContexts,
) {
    free_with_timing(timing, move || unsafe {
        free_view_and_contexts(view, contexts);
    });
}

fn free_runtime_with_timing(timing: &mut NativeTeardownTiming<'_>, runtime: usize) {
    free_with_timing(timing, move || {
        unsafe { muxed_ghostty_runtime_free(runtime as *mut c_void) };
    });
}

fn free_with_timing(timing: &mut NativeTeardownTiming<'_>, free: impl FnOnce() + Send + 'static) {
    match timing {
        NativeTeardownTiming::Immediate => free(),
        NativeTeardownTiming::Deferred(frees) => frees.push(Box::new(free)),
    }
}

/// Calls Tauri's main-thread dispatcher from a fresh worker thread. Tauri
/// executes `run_on_main_thread` inline when its caller is already the main
/// thread, so calling it directly from WebKit's navigation callback does not
/// defer anything.
fn defer_native_frees(application: &tauri::AppHandle, frees: Vec<NativeFree>) {
    if frees.is_empty() {
        return;
    }
    let application = application.clone();
    let batch = Box::new(move || {
        for free in frees {
            free();
        }
    });
    let dispatch = move |batch: NativeFree| {
        // A rejected dispatch means the event loop is already gone. Dropping
        // the batch leaves the native allocations in place for the remainder
        // of the process rather than freeing AppKit objects off the main
        // thread.
        if let Err(error) = application.run_on_main_thread(move || batch()) {
            eprintln!("Ticketry could not schedule native viewer teardown: {error}");
        }
    };
    if let Err(error) = dispatch_from_fresh_thread(dispatch, batch) {
        eprintln!("Ticketry could not defer native viewer teardown: {error}");
    }
}

fn dispatch_from_fresh_thread(
    dispatch: impl FnOnce(NativeFree) + Send + 'static,
    batch: NativeFree,
) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("ticketry-native-teardown".to_owned())
        .spawn(move || dispatch(batch))
        .map(|_| ())
}
