use seaography::CustomOutputType;
use serde::Serialize;

/// The bounded receipt for one Git write. Repository facts still live in the
/// existing Changes queries; Studio refetches those queries after the command.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct RepositoryCommandResult {
    pub operation_id: String,
    pub head_commit: String,
    pub dirty: bool,
    pub unpushed_count: i32,
    pub uncommitted_work_excluded: bool,
}
