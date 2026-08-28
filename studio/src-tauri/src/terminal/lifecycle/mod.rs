//! Bounded startup, periodic recovery, and shutdown for the Rust terminal runtime.

mod runtime;
mod spool_layout;
mod work;

pub use runtime::{TerminalLifecycleConfig, TerminalLifecycleError, TerminalLifecycleRuntime};
pub use spool_layout::{ensure_hook_spool_directory, hook_spool_directory};
pub use work::{
    InteractiveTerminalLaunchRuntime, ProductionTerminalLifecycleWork,
    RecoveryTerminalLaunchRuntime, TerminalLifecycleWork, TerminalRuntimeAuthority,
};
