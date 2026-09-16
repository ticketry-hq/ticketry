//! Bounded startup, periodic recovery, and shutdown for the Rust terminal runtime.

mod entry_skill_delivery;
mod runtime;
mod sweep;
mod work;

pub use runtime::{TerminalLifecycleConfig, TerminalLifecycleError, TerminalLifecycleRuntime};
pub use work::{
    InteractiveTerminalLaunchRuntime, ProductionTerminalLifecycleWork,
    RecoveryTerminalLaunchRuntime, TerminalLifecycleWork, TerminalRuntimeAuthority,
};
