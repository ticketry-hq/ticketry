//! SeaORM mapping for the adopted `worktrees` table.

pub mod worktree;

/// Register the generated Worktree read graph. The generated mutation bundle
/// stays private: in Seaography rc.9 registration is all-or-nothing, and the
/// audited create-one, create-batch, update, and delete operations cannot
/// derive checkout identity, hold the per-repository lock, prove Git evidence,
/// or settle a durable Workspace Operation. See
/// the worktree slice’s `persistence::ownership_manifest` for the recorded reason.
pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    seaography::register_entity!(builder, worktree, mutation: false);
    builder
}
