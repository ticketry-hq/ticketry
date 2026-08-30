//! Terminal Session GraphQL views.

mod views;

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    views::register(builder)
}
