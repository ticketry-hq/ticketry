//! Explicit, branch-scoped preparation of one mapped pull request.

mod error;
pub mod launcher;
mod operation_registry;
mod prompt;
mod service;
mod types;

pub use error::MergePreparationError;
pub use launcher::MergePreparationLauncher;
pub use service::MergePreparationService;
pub use types::{LaunchedAgent, MergePreparationResult};

pub fn assert_operation_registered() {
    operation_registry::assert_complete();
}
