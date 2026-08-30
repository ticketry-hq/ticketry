//! Automation Attempt GraphQL projection and command views.

mod queries;
mod support;
mod views;

pub(super) fn register_graphql(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<crate::runs_persistence::AutomationAttemptProjection>();
    queries::register(&mut builder);
    views::register(&mut builder);
    builder
}
