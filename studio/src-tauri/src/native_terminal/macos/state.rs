// Native runtime, viewer registry, attachment reservation, and teardown state.

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalStatus {
    handle: String,
    run_id: String,
    columns: u16,
    rows: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTerminalCompletion {
    handle: String,
    run_id: String,
    reason: String,
}

/// One Studio chord recognised by a presented native viewer. The identifiers
/// are carried for tracing; Studio's binding owns the action.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTerminalChord {
    handle: String,
    run_id: String,
    chord: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTerminalFailure {
    handle: String,
    run_id: String,
    reason: String,
}

pub struct NativeTerminalState {
    runtime: Mutex<Option<usize>>,
    entries: Arc<Mutex<HashMap<String, NativeEntry>>>,
    /// Run ids reserved by attach commands that have not yet inserted an
    /// entry. Keeping this separate from the completed entry map closes
    /// the multi-second check/create race without exposing half-built
    /// native views to the rest of the command surface.
    attaching: Arc<Mutex<NativeAttachRegistry>>,
    /// Geometry published for viewers that are still preparing, so a
    /// layout change during preparation reaches the surface before it is
    /// presented rather than after its first visible redraw.
    pending_frames: PendingFrames,
}

/// Callback contexts leaked to one native view. Each is released only after
/// that view has disabled the callback which reads it, so no context is freed
/// while the view can still emit through it.
#[derive(Clone, Copy, Default)]
struct NativeViewContexts {
    /// Leaked `Arc<ScrollGestureSink>`.
    scroll: usize,
    /// Leaked `Arc<ChordSink>`.
    chord: usize,
    /// Leaked worker sender, read by the child-exit and grid-resize callbacks.
    process: usize,
}

struct NativeEntry {
    run_id: String,
    view: usize,
    worker: mpsc::Sender<NativeViewerCommand>,
    scroll_sink: Arc<ScrollGestureSink>,
    chord_sink: Arc<ChordSink>,
    contexts: NativeViewContexts,
    visibility: NativeTerminalVisibility,
    preparation_phase: Arc<AtomicU8>,
}

struct NativePreparedViewerMechanics {
    window: tauri::WebviewWindow,
    entries: Arc<Mutex<HashMap<String, NativeEntry>>>,
    handle: String,
}

impl crate::viewer_ownership::PreparedViewerMechanics for NativePreparedViewerMechanics {
    fn detach(&self, _reason: crate::viewer_ownership::ViewerDetachReason) {
        let _ = detach_native_handle(&self.window, &self.entries, &self.handle);
    }
}

fn detach_native_handle(
    window: &tauri::WebviewWindow,
    entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
    handle: &str,
) -> Result<(), String> {
    let entry = entries
        .lock()
        .expect("native terminal registry poisoned")
        .remove(handle)
        .ok_or_else(|| "native terminal handle was not found".to_owned())?;
    entry.stop_accepting_events();
    let _ = entry.worker.send(NativeViewerCommand::Detach);
    free_view(window, entry.view, entry.contexts).map_err(|error| error.to_string())
}

impl NativeEntry {
    /// Viewer detachment stops accepting reported events before the native
    /// view is removed, so an event in flight cannot reach the next viewer.
    fn stop_accepting_events(&self) {
        self.scroll_sink.stop_accepting();
        self.chord_sink.stop_accepting();
    }
}

#[derive(Default)]
struct NativeAttachRegistry {
    generation: u64,
    runs: HashMap<String, Arc<AtomicU8>>,
}

impl NativeAttachRegistry {
    fn cancel_all(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        for phase in self.runs.values() {
            phase.store(FAILED, Ordering::Release);
        }
    }
}

struct NativeAttachReservation {
    run_id: String,
    generation: u64,
    phase: Arc<AtomicU8>,
    attaching: Arc<Mutex<NativeAttachRegistry>>,
}

impl NativeAttachReservation {
    fn acquire(
        entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
        attaching: &Arc<Mutex<NativeAttachRegistry>>,
        run_id: &str,
    ) -> Result<Self, String> {
        // Every attach takes the reservation lock before inspecting the
        // entry map. The reservation remains present until the command
        // either fails or has installed its completed entry.
        let mut registry = attaching
            .lock()
            .expect("native terminal attachment registry poisoned");
        let already_attached = registry.runs.contains_key(run_id)
            || entries
                .lock()
                .expect("native terminal registry poisoned")
                .values()
                .any(|entry| entry.run_id == run_id);
        if already_attached {
            return Err("a native viewer is already attached to this run".to_owned());
        }
        let phase = Arc::new(AtomicU8::new(PREPARING));
        registry.runs.insert(run_id.to_owned(), Arc::clone(&phase));
        Ok(Self {
            run_id: run_id.to_owned(),
            generation: registry.generation,
            phase,
            attaching: Arc::clone(attaching),
        })
    }

    fn insert_entry(
        &self,
        entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
        handle: String,
        entry: NativeEntry,
    ) -> Result<(), String> {
        let registry = self
            .attaching
            .lock()
            .expect("native terminal attachment registry poisoned");
        if !self.is_current(&registry) {
            return Err("native terminal attachment was cancelled by teardown".to_owned());
        }
        entries
            .lock()
            .expect("native terminal registry poisoned")
            .insert(handle, entry);
        Ok(())
    }

    fn is_current(&self, registry: &NativeAttachRegistry) -> bool {
        registry.generation == self.generation && self.phase.load(Ordering::Acquire) == PREPARING
    }
}

impl Drop for NativeAttachReservation {
    fn drop(&mut self) {
        let mut registry = self
            .attaching
            .lock()
            .expect("native terminal attachment registry poisoned");
        if registry
            .runs
            .get(&self.run_id)
            .is_some_and(|phase| Arc::ptr_eq(phase, &self.phase))
        {
            registry.runs.remove(&self.run_id);
        }
    }
}

struct WorkerSetup {
    control: TerminalCommandAttachmentControl,
    commands: Receiver<NativeViewerCommand>,
    window: tauri::WebviewWindow,
    entries: Arc<Mutex<HashMap<String, NativeEntry>>>,
    handle: String,
    run_id: String,
    preparation_phase: Arc<AtomicU8>,
}

// All Objective-C pointers are created and consumed on AppKit's main
// thread. They cross command threads only as inert integer handles.
unsafe impl Send for NativeTerminalState {}
unsafe impl Sync for NativeTerminalState {}

impl Default for NativeTerminalState {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeTerminalState {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(None),
            entries: Arc::new(Mutex::new(HashMap::new())),
            attaching: Arc::new(Mutex::new(NativeAttachRegistry::default())),
            pending_frames: PendingFrames::default(),
        }
    }
}
