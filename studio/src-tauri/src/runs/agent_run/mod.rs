//! Agent Run GraphQL projections and lifecycle-ingress view.

mod queries;
mod support;
mod views;

pub(super) fn register_graphql(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<crate::runs_persistence::AgentRunHolding>();
    queries::register(&mut builder);
    views::register(&mut builder);
    builder
}
