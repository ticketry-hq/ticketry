//! Revisioned Launch Binding mutation views.
//!
//! Generated writes remain private because a binding update must validate the
//! complete launch policy and advance its Issue Type revision in one transaction.

pub(crate) mod skill_availability;
mod views;

pub fn register(builder: &mut seaography::Builder) {
    views::register(builder);
    skill_availability::register(builder);
}
