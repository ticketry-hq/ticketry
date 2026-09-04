//! Bounded startup, periodic recovery, and shutdown for the Rust terminal runtime.

mod provider_executable;
mod runtime;
mod work;

pub use runtime::{TerminalLifecycleConfig, TerminalLifecycleError, TerminalLifecycleRuntime};
pub use work::{
    InteractiveTerminalLaunchRuntime, ProductionTerminalLifecycleWork,
    RecoveryTerminalLaunchRuntime, TerminalLifecycleWork, TerminalRuntimeAuthority,
};
