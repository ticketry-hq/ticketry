//! Restricted GraphQL views for durable terminal viewer ownership.

mod views;

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    views::register(builder)
}
