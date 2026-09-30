//! Authored Design Document mutation views.

mod refresh_scratch_registry;
mod refresh_task_registry;
mod save;
mod support;

pub(super) fn register(builder: &mut seaography::Builder) {
    refresh_task_registry::register(builder);
    refresh_scratch_registry::register(builder);
    save::register(builder);
}
