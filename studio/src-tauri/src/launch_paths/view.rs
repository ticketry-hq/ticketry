//! What a launch is told, and nothing more.
//!
//! The answer is deliberately shaped like the decision the terminal capability
//! has always made: a working directory to override the module folder with, a
//! design directory to point the run's documents at, and enough cosmetic
//! naming for the prompt text. It carries no branch, no base ref, no
//! repository root, no worktree row identity, and no document body, because a
//! launch needs none of those and publishing them would hand the still-Python
//! side material it must no longer act on.

use serde::Serialize;

/// Why the run is, or is not, rooted in a task worktree. This is reported so
/// the fallback is visible in logs and tests rather than inferred from a null.
pub const WORKTREE_USED: &str = "used";
pub const WORKTREE_NOT_APPLICABLE: &str = "not_applicable";
pub const WORKTREE_NONE: &str = "none";
pub const WORKTREE_CHECKOUT_MISSING: &str = "checkout_missing";

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct WorktreeUse {
    /// Whether the run is rooted in a task worktree.
    pub used: bool,
    /// The top-level Work Item that owns the checkout, when one was resolved.
    pub top_level_task_id: Option<String>,
    /// True when the launched Work Item shares an ancestor's checkout.
    pub is_shared: bool,
    /// The durable lifecycle state of the used row, `active` or `conflict`.
    pub state: Option<String>,
    /// `used`, `none`, `checkout_missing`, or `not_applicable`.
    pub reason: String,
}

impl WorktreeUse {
    pub(super) fn not_applicable() -> Self {
        Self {
            reason: WORKTREE_NOT_APPLICABLE.to_owned(),
            ..Self::default()
        }
    }

    pub(super) fn absent(
        top_level_task_id: String,
        is_shared: bool,
        reason: &'static str,
    ) -> Self {
        Self {
            used: false,
            top_level_task_id: Some(top_level_task_id),
            is_shared,
            state: None,
            reason: reason.to_owned(),
        }
    }

    pub(super) fn used(top_level_task_id: String, is_shared: bool, state: String) -> Self {
        Self {
            used: true,
            top_level_task_id: Some(top_level_task_id),
            is_shared,
            state: Some(state),
            reason: WORKTREE_USED.to_owned(),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct LaunchPathsView {
    /// The directory the agent process should run in, or `None` to keep the
    /// module folder the caller already resolved.
    pub working_directory: Option<String>,
    /// The absolute authorized design directory for this run, or `None` when
    /// no root could be resolved — a launch still proceeds without documents.
    pub design_directory: Option<String>,
    /// The same directory relative to its root, which is what prompt text and
    /// the canonical layout contract speak in.
    pub design_directory_relative: Option<String>,
    /// The module's canonical directory name, for prompt text that tells an
    /// agent where a planning artifact should eventually land.
    pub module_directory_name: Option<String>,
    /// For a doc-chat run, the registered document's path relative to its
    /// root. It is derived from the registry row, not echoed from the caller.
    pub document_relative_path: Option<String>,
    pub worktree: WorktreeUse,
}
