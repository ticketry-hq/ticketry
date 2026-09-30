//! The only thing a launch may ask for.
//!
//! Every field is an identity or a scope. `deny_unknown_fields` is the load
//! bearing part: a caller that tries to smuggle a `path`, `cwd`, `root_dir`,
//! `branch`, `git`, `content`, or any other field is rejected outright rather
//! than having the extra key quietly ignored.

use serde::Deserialize;

/// Which kind of run is being launched. The variants match the durable Agent
/// Run scopes the terminal capability already spawns.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LaunchScope {
    /// A run bound to one Work Item, which may use that item's worktree.
    Task,
    /// A module-scoped planning run with its own run-scoped design directory.
    Plan,
    /// A module-scoped instant-change run, scoped exactly like planning.
    Instant,
    /// A run scoped to one already-registered design document.
    Docchat,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaunchPathsRequest {
    /// Contract version, so a stale sidecar cannot be misread as a new one.
    pub version: u8,
    pub scope: LaunchScope,
    /// The Agent Run the directories belong to. A planning or instant run's
    /// design directory is scoped by this identity, which is what keeps two
    /// scratch runs from overwriting each other.
    pub agent_run_id: String,
    pub project_id: String,
    /// The module the caller selected. For a task launch it is checked against
    /// the module derived from the Work Item graph rather than trusted.
    #[serde(default)]
    pub module_id: Option<String>,
    /// The Work Item a task launch targets. Required for `task`, ignored
    /// otherwise.
    #[serde(default)]
    pub task_id: Option<String>,
    /// The registered document a doc-chat run is scoped to. It is a registry
    /// identity, never a relative or absolute path.
    #[serde(default)]
    pub document_id: Option<String>,
}

pub(super) const SUPPORTED_VERSION: u8 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: serde_json::Value) -> Result<LaunchPathsRequest, serde_json::Error> {
        serde_json::from_value(value)
    }

    fn task_request() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "scope": "task",
            "agent_run_id": "0f7f2b8a5d2c4c2f9d1a0b3c4d5e6f70",
            "project_id": "10000000-0000-0000-0000-000000000000",
            "module_id": "20000000-0000-0000-0000-000000000001",
            "task_id": "60000000-0000-0000-0000-000000000001"
        })
    }

    #[test]
    fn an_identity_only_request_is_accepted() {
        let request = parse(task_request()).expect("accept an identity-only request");

        assert_eq!(request.scope, LaunchScope::Task);
        assert_eq!(request.version, SUPPORTED_VERSION);
        assert!(request.document_id.is_none());
    }

    #[test]
    fn no_place_command_or_body_may_enter_the_boundary() {
        for smuggled in [
            "path",
            "cwd",
            "root_dir",
            "design_dir",
            "module_folder",
            "repo_root",
            "branch",
            "base_branch",
            "git",
            "args",
            "content",
            "rel_path",
            "status",
            "ephemeral",
        ] {
            let mut body = task_request();
            body[smuggled] = serde_json::json!("anything at all");

            assert!(
                parse(body).is_err(),
                "the boundary accepted a `{smuggled}` field"
            );
        }
    }

    #[test]
    fn an_unknown_scope_is_not_a_launch() {
        let mut body = task_request();
        body["scope"] = serde_json::json!("integrate");

        assert!(parse(body).is_err());
    }
}
