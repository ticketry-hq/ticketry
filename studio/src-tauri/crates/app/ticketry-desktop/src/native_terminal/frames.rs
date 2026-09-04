//! Pane geometry for native Terminal viewers.
//!
//! Studio measures the mounted terminal host and clips it to the webview
//! viewport. That frame is the native attach contract, and it can go stale
//! while attachment preparation runs. This module owns the frame value, its
//! validation, and the latest frame Studio published for a viewer that is
//! still preparing.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
}

pub fn validate_frame(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
) -> Result<(), String> {
    let values = [x, y, width, height, viewport_width, viewport_height];
    if values.iter().any(|value| !value.is_finite())
        || x < 0.0
        || y < 0.0
        || width <= 0.0
        || height <= 0.0
        || viewport_width <= 0.0
        || viewport_height <= 0.0
        || x + width > viewport_width + 1.0
        || y + height > viewport_height + 1.0
    {
        return Err("native terminal frame is invalid".to_owned());
    }
    Ok(())
}

pub fn validate_native_frame(frame: NativeTerminalFrame) -> Result<(), String> {
    validate_frame(
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        frame.viewport_width,
        frame.viewport_height,
    )
}

pub fn validate_webview_interaction_frames(frames: &[NativeTerminalFrame]) -> Result<(), String> {
    for frame in frames {
        validate_native_frame(*frame)?;
    }
    Ok(())
}

/// The newest frame Studio published for each preparing viewer, keyed by run.
///
/// A preparing viewer has no handle yet, so its live geometry arrives under
/// the run it is attaching to. Preparation consumes the frame before anything
/// is presented; only the newest one matters, so publishing replaces rather
/// than queues.
#[derive(Debug, Default)]
pub struct PendingFrames {
    frames: Mutex<HashMap<String, NativeTerminalFrame>>,
}

impl PendingFrames {
    pub fn publish(&self, run_id: &str, frame: NativeTerminalFrame) {
        self.locked().insert(run_id.to_owned(), frame);
    }

    pub fn take(&self, run_id: &str) -> Option<NativeTerminalFrame> {
        self.locked().remove(run_id)
    }

    pub fn discard(&self, run_id: &str) {
        self.locked().remove(run_id);
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, HashMap<String, NativeTerminalFrame>> {
        self.frames
            .lock()
            .expect("native terminal pending frames poisoned")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: f64, height: f64) -> NativeTerminalFrame {
        NativeTerminalFrame {
            x: 0.0,
            y: 0.0,
            width,
            height,
            viewport_width: width,
            viewport_height: height,
        }
    }

    #[test]
    fn frame_validation_rejects_non_finite_and_out_of_viewport_geometry() {
        assert!(validate_frame(8.0, 8.0, 800.0, 600.0, 1024.0, 768.0).is_ok());
        assert!(validate_frame(f64::NAN, 0.0, 1.0, 1.0, 10.0, 10.0).is_err());
        assert!(validate_frame(8.0, 8.0, 20.0, 20.0, 16.0, 16.0).is_err());
        assert!(validate_frame(0.0, 0.0, 0.0, 1.0, 10.0, 10.0).is_err());
    }

    #[test]
    fn preparation_reads_only_the_newest_published_frame_for_its_run() {
        let pending = PendingFrames::default();

        pending.publish("run-1", frame(800.0, 600.0));
        pending.publish("run-1", frame(640.0, 480.0));
        pending.publish("run-2", frame(320.0, 240.0));

        let taken = pending.take("run-1").expect("published frame");
        assert_eq!((taken.width, taken.height), (640.0, 480.0));
        assert!(pending.take("run-1").is_none());
        assert!(pending.take("run-2").is_some());
    }

    #[test]
    fn a_discarded_run_leaves_no_frame_for_a_later_attachment() {
        let pending = PendingFrames::default();

        pending.publish("run-1", frame(800.0, 600.0));
        pending.discard("run-1");

        assert!(pending.take("run-1").is_none());
    }

    #[test]
    fn webview_interaction_accepts_empty_or_valid_overlay_frames_only() {
        assert!(validate_webview_interaction_frames(&[]).is_ok());
        assert!(validate_webview_interaction_frames(&[frame(800.0, 600.0)]).is_ok());
        assert!(validate_webview_interaction_frames(&[frame(0.0, 600.0)]).is_err());
    }
}
