//! GraphQL views for the Design Document workspace capability.

mod views;

/// Register authored Design Document registry views on the composed schema.
pub(crate) fn register_graphql(mut builder: seaography::Builder) -> seaography::Builder {
    views::register(&mut builder);
    builder
}
