#![deny(private_bounds, private_interfaces)]

//! Ticketry's process-local planner transport over its installed GraphQL endpoint.
//! Database ownership, installation and every model write remain in Ticketry's
//! existing composition. This crate never opens or migrates a database.

mod endpoint;
mod frontend_origin;
mod http;
mod runtime;

pub use endpoint::PlannerEndpoint;
pub use frontend_origin::PlannerFrontendOrigin;
pub use runtime::PlannerService;
