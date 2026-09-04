//! Named viewer threads with durable start, exit, and panic records.

use serde_json::json;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::thread;

pub(super) fn spawn(
    role: &'static str,
    agent_run_id: &str,
    viewer_handle: &str,
    work: impl FnOnce() + Send + 'static,
) {
    let run = agent_run_id.to_owned();
    let handle = viewer_handle.to_owned();
    let thread_run = run.clone();
    let thread_handle = handle.clone();
    let result = thread::Builder::new()
        .name(format!("terminal-{role}"))
        .spawn(move || {
            super::super::diagnostics::record(
                "terminal-viewer-thread-started",
                Some(&thread_run),
                json!({"viewerHandle": thread_handle, "role": role}),
            );
            match catch_unwind(AssertUnwindSafe(work)) {
                Ok(()) => super::super::diagnostics::record(
                    "terminal-viewer-thread-ended",
                    Some(&thread_run),
                    json!({"viewerHandle": thread_handle, "role": role}),
                ),
                Err(payload) => {
                    super::super::diagnostics::record(
                        "terminal-viewer-thread-panicked",
                        Some(&thread_run),
                        json!({
                            "viewerHandle": thread_handle,
                            "role": role,
                            "message": panic_message(payload.as_ref()),
                        }),
                    );
                    resume_unwind(payload);
                }
            }
        });
    if let Err(error) = result {
        super::super::diagnostics::record(
            "terminal-viewer-thread-spawn-failed",
            Some(&run),
            json!({"viewerHandle": handle, "role": role, "message": error.to_string()}),
        );
        panic!("could not spawn terminal {role} thread: {error}");
    }
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("non-string panic payload")
}
