//! Bounded startup, periodic recovery, and shutdown for the Rust terminal runtime.

mod runtime;
mod work;

pub use runtime::{TerminalLifecycleConfig, TerminalLifecycleError, TerminalLifecycleRuntime};
pub use work::{
    hook_spool_directory, InteractiveTerminalLaunchRuntime, ProductionTerminalLifecycleWork,
    RecoveryTerminalLaunchRuntime, TerminalLifecycleWork, TerminalRuntimeAuthority,
};
