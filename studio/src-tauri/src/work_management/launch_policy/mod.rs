mod auto_start;
mod catalog;
mod compatibility;
mod context;
mod decisions;
mod resolver;
mod rows;
mod skills;
mod types;

pub use auto_start::prepare_pending_auto_starts;
pub use compatibility::submit_interactive;
pub use decisions::{mark_delivered, pending, record};
pub use resolver::LaunchPolicyResolver;
pub use types::{
    CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest, ModuleLinkInput,
    SelectedProfileInput,
};

pub(crate) use decisions::ensure_schema;
