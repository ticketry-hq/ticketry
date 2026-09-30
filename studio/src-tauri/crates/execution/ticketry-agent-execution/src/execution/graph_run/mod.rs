//! Graph Run model views backed by the serialized execution service.

pub mod action_compatibility;
mod operation_registry;
mod views;

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    operation_registry::assert_complete();
    views::register(builder)
}
