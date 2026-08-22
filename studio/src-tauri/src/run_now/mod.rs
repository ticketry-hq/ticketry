//! Guarded Ideas-to-Implement transition followed by one task launch.

mod graphql;
mod launcher;
mod operation_registry;
mod service;
mod types;

pub use launcher::RunNowLauncher;
pub use operation_registry::{DomainOperationRegistration, DOMAIN_OPERATIONS};
pub use service::RunNowService;
pub use types::{
    RunNowCaller, RunNowRefusal, RunNowRequest, RunNowRun, RunNowState, RunNowSuccess,
};

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}

#[cfg(test)]
mod registry_contract {
    #[test]
    fn operation_registry_is_linked() {
        assert_eq!(
            super::operation_registry::DOMAIN_OPERATIONS[0].field,
            "runNow"
        );
    }
}
