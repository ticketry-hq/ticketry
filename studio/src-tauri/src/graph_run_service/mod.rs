//! Serialized create, manual press, and reset for one dependency-graph campaign.

mod claim;
mod error;
mod graphql;
mod graphql_scope;
mod operation_registry;
mod service;
mod types;

pub use error::{GraphRunServiceError, GraphRunServiceErrorCode};
pub(crate) use service::set_production_mutations_open;
pub use service::GraphRunService;
pub use types::{
    DeletedGraphRunResult, GraphRunAdvanceResult, GraphRunRequest, GraphRunResult, LaunchedChild,
    ResetGraphRunResult,
};

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}

pub use graphql_scope::GraphRunCaller;
pub(crate) use graphql_scope::GraphRunReadScope;
