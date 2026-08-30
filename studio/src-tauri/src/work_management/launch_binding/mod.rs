//! Revisioned Launch Binding mutation views.
//!
//! Generated writes remain private because a binding update must validate the
//! complete launch policy and advance its Issue Type revision in one transaction.

mod views;

pub(crate) fn register(builder: &mut seaography::Builder) {
    views::register(builder);
}
