//! Revisioned Issue Type Transition mutation views.
//!
//! Generated transition writes remain private. Each public field binds the
//! transition's natural key and a workflow revision, while the command service
//! updates the transition row and owning Issue Type in one transaction.

mod views;

pub(crate) fn register(builder: &mut seaography::Builder) {
    views::register(builder);
}
