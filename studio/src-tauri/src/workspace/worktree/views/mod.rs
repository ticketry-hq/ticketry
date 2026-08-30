//! Worktree mutation views.

mod create;
mod discard;

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    create::register(&mut builder);
    discard::register(&mut builder);
    builder
}
