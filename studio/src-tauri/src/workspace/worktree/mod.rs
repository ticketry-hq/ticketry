//! Workspace-owned Worktree GraphQL views.

mod views;

/// Register the authored Worktree views in the product schema.
pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    views::register(builder)
}
