//! A real run-scoped principal for execution-harness MCP calls.
//!
//! MCP authorization is owned in-process after the Rust migration. The harness
//! therefore records one active caller Agent Run, asks the real `RunAuthority`
//! for its bearer grant, and presents that grant over the HTTP transport. The
//! caller row is test scaffolding, not a campaign launch, and is removed during
//! normal harness shutdown.
#![allow(dead_code)]

use std::sync::Mutex;

use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, IntoActiveModel, Set};
use ticketry_entities::agent_run;
use ticketry_entities::issue;
use ticketry_mcp::RunAuthority;

use super::execution_fixture as fixture;

pub(super) const AUTHORIZATION_CREDENTIAL: &str = "slice6-harness-credential";
pub const CALLER_RUN_ID: &str = "slice6-caller";

const ALLOWED_TOOLS: [&str; 3] = [
    "execute_dependency_graph",
    "get_dependency_graph",
    "update_task_status",
];

#[derive(Clone)]
struct Binding {
    project_id: String,
    issue_id: String,
}

pub struct Authorization {
    binding: Mutex<Binding>,
    credential: Mutex<Option<String>>,
}

impl Default for Authorization {
    fn default() -> Self {
        Self {
            binding: Mutex::new(Binding {
                project_id: fixture::CAMPAIGN_PROJECT.to_owned(),
                // Keep the test caller outside every execution graph. It
                // authorizes the request but must never look like a runtime
                // already working the campaign being pressed.
                issue_id: fixture::CHILDLESS_ROOT.to_owned(),
            }),
            credential: Mutex::new(None),
        }
    }
}

impl Authorization {
    /// Bind the caller to another project, so a cross-project request is
    /// observed being refused by the composed scope rules.
    pub fn bind_to_project(&self, project_id: &str, issue_id: &str) {
        *self.binding.lock().expect("authorization binding lock") = Binding {
            project_id: project_id.to_owned(),
            issue_id: issue_id.to_owned(),
        };
    }

    pub(super) async fn start(&self, database: &DatabaseConnection, authority: &RunAuthority) {
        agent_run::Entity::delete_by_id(CALLER_RUN_ID)
            .exec(database)
            .await
            .expect("clear an old harness caller run");
        let binding = self.validated_binding(database).await;
        agent_run::ActiveModel {
            id: Set(CALLER_RUN_ID.to_owned()),
            issue_id: Set(binding.issue_id),
            ticket_seq: Set(None),
            agent: Set(Some("codex".to_owned())),
            initial_prompt: Set(None),
            status: Set("running".to_owned()),
            started_at: Set("2026-08-19T17:00:00Z".to_owned()),
            ended_at: Set(None),
            exit_code: Set(None),
            error: Set(None),
            cwd: Set(None),
            provider_session_id: Set(None),
            lifecycle_state: Set(Some("working".to_owned())),
            lifecycle_updated_at: Set(Some("2026-08-19T17:00:00Z".to_owned())),
            design_dir: Set(None),
            resumed_from: Set(None),
            scope: Set("task".to_owned()),
            launch_state: Set(None),
            launch_model: Set(None),
            launch_reasoning: Set(None),
            launch_unattended: Set(false),
        }
        .insert(database)
        .await
        .expect("record the harness caller run");
        let credential = authority
            .issue(CALLER_RUN_ID, ALLOWED_TOOLS.into_iter().map(str::to_owned))
            .await
            .unwrap_or_else(|failure| panic!("issue the harness MCP grant: {}", failure.0));
        *self
            .credential
            .lock()
            .expect("authorization credential lock") = Some(credential);
    }

    /// Apply a test's newest project binding before authenticating its request.
    pub(super) async fn refresh_binding(&self, database: &DatabaseConnection) {
        let binding = self.validated_binding(database).await;
        let caller = agent_run::Entity::find_by_id(CALLER_RUN_ID)
            .one(database)
            .await
            .expect("read the harness caller run")
            .expect("the harness caller run is active");
        if caller.issue_id != binding.issue_id {
            let mut update = caller.into_active_model();
            update.issue_id = Set(binding.issue_id);
            update
                .update(database)
                .await
                .expect("rebind the harness caller run");
        }
    }

    pub(super) fn credential(&self) -> String {
        self.credential
            .lock()
            .expect("authorization credential lock")
            .clone()
            .expect("the harness MCP grant is issued")
    }

    pub(super) async fn stop(&self, database: &DatabaseConnection) {
        *self
            .credential
            .lock()
            .expect("authorization credential lock") = None;
        agent_run::Entity::delete_by_id(CALLER_RUN_ID)
            .exec(database)
            .await
            .expect("remove the harness caller run");
    }

    async fn validated_binding(&self, database: &DatabaseConnection) -> Binding {
        let binding = self
            .binding
            .lock()
            .expect("authorization binding lock")
            .clone();
        let item = issue::Entity::find_by_id(&binding.issue_id)
            .one(database)
            .await
            .expect("read the harness caller issue")
            .expect("the harness caller issue exists");
        assert_eq!(
            item.project_id, binding.project_id,
            "the harness principal binds matching issue and project identities"
        );
        binding
    }
}
