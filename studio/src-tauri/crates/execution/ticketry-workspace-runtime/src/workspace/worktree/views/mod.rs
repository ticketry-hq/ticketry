//! Worktree mutation views.

mod cleanup;
mod commit;
mod create;
mod discard;
mod merge_preparation;
mod pull_request;
mod push;

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    commit::register(&mut builder);
    cleanup::register(&mut builder);
    create::register(&mut builder);
    discard::register(&mut builder);
    merge_preparation::register(&mut builder);
    push::register(&mut builder);
    pull_request::register(&mut builder);
    builder
}
