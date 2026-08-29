//! macOS native Terminal implementation, split by lifecycle concern.

use super::frames::{validate_frame, validate_native_frame, PendingFrames};
use super::preparation::{PreparationGate, TerminalGrid};
use super::scroll::ScrollGestureSink;
use super::visibility::NativeTerminalVisibility;
use super::worker::{run_native_worker, NativeViewerCommand, NativeWorkerExit};
use super::NativeTerminalFrame;
use crate::native_terminal::chords::{ChordSink, StudioChord, NATIVE_CHORD_EVENT};
use crate::terminal::viewer::attachment::{
    TerminalCommandAttachment, TerminalCommandAttachmentControl,
};
use rand::Rng;
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CString};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

const PREPARATION_TIMEOUT: Duration = Duration::from_secs(5);
/// How many times preparation adopts newer geometry before presenting.
/// A user dragging a window edge publishes frames continuously, so the
/// gate settles on the newest frame instead of chasing every one.
const MAX_FRAME_RECONCILIATIONS: usize = 3;
const PREPARING: u8 = 0;
const PRESENTED: u8 = 1;
const FAILED: u8 = 2;

include!("platform_bridge.rs");
include!("state.rs");
include!("attach_commands.rs");
include!("presentation_commands.rs");
include!("lifecycle.rs");
include!("platform_tests.rs");
