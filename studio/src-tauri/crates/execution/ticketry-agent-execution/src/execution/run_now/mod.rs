//! Guarded Ideas-to-Implement transition that converts the Story to
//! Implementation, followed by one task launch.

mod launcher;
mod operation_registry;
mod refusals;
mod service;
mod types;
mod views;

pub use launcher::RunNowLauncher;
pub use operation_registry::{DomainOperationRegistration, DOMAIN_OPERATIONS};
pub use service::RunNowService;
pub use types::{
    RunNowCaller, RunNowIssueType, RunNowRefusal, RunNowRequest, RunNowRun, RunNowState,
    RunNowSuccess,
};

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    operation_registry::assert_complete();
    views::register(builder)
}
