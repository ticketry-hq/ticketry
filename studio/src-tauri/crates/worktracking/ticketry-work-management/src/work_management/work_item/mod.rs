//! Work Item mutation views.
//!
//! Work Item creation, update, reorder, and deletion remain authored because
//! they change an aggregate inside domain transactions. Their public GraphQL
//! plumbing lives with the fields that own it.

mod views;

pub fn register_mutations(builder: &mut seaography::Builder) {
    views::register(builder);
}
