//! Revisioned Issue Type workflow membership views.

mod views;

pub(crate) fn register(builder: &mut seaography::Builder) {
    views::register(builder);
}
