//! Continuing a work item's live agent session across a handoff edge.
//!
//! A handoff edge never changes *whether* the destination launches — it
//! changes *how*. When the work item still owns a live, input-capable agent
//! session, the composed destination prompt and the destination entry skill
//! are typed into that session instead of a fresh agent being spawned. When it
//! does not, the caller falls back to the fresh launch an unchecked edge would
//! have produced.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};

use ticketry_entities::session;
use ticketry_launch::{provider_contract, Provider};
use ticketry_terminal::TmuxAdapter;
use ticketry_terminal::{
    entry_skill_invocation, DeliveryTimings, PromptDelivery, PromptDeliveryError,
    PromptDeliveryTmux, TmuxPromptDelivery,
};

const HANDOFF_READINESS_TIMEOUT_SECONDS_ENV: &str = "TICKETRY_HANDOFF_READINESS_TIMEOUT_SECONDS";

/// The live session a handoff continues, and the provider whose composer
/// contract governs typed delivery into it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct LiveAgentSession {
    pub agent_run_id: String,
    pub provider: Provider,
}

/// The work item's newest live, input-capable task session, if it has one.
///
/// Open rows are checked against tmux newest first. If none verifies, the
/// newest durable candidate still blocks a fresh spawn. Delivery then records
/// the verification failure for an explicit retry instead of guessing that the
/// existing agent is gone.
pub(super) async fn live_agent_session(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<Option<LiveAgentSession>, sea_orm::DbErr> {
    let candidates = open_sessions(database, task_id).await?;
    if candidates.is_empty() {
        return Ok(None);
    }
    // Runtime verification shells out to tmux, so it never runs on the async
    // executor. If every verification fails, preserve the newest durable
    // candidate. Delivery will report a retryable failure through its own
    // verification instead of treating uncertainty as permission to spawn a
    // second agent.
    let fallback = candidates.first().cloned();
    Ok(
        tokio::task::spawn_blocking(move || candidates.into_iter().find(runtime_is_live))
            .await
            .ok()
            .flatten()
            .or(fallback),
    )
}

/// Type the destination prompt, then the destination entry skill, into a live
/// session.
///
/// They are always two submissions. A provider treats one paste as one
/// message, so combining them would hand the agent a prompt with a literal
/// skill invocation inside it rather than invoking the skill.
pub(super) async fn deliver(
    live: &LiveAgentSession,
    prompt: String,
    entry_skill: Option<String>,
) -> Result<(), String> {
    let provider = live.provider;
    let run_id = live.agent_run_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut delivery = PromptDelivery::with_timings(
            TmuxPromptDelivery::discover()?,
            DeliveryTimings::handoff(configured_readiness_timeout()),
        );
        submit_destination(
            &mut delivery,
            provider,
            &run_id,
            &prompt,
            entry_skill.as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

fn configured_readiness_timeout() -> Option<std::time::Duration> {
    std::env::var(HANDOFF_READINESS_TIMEOUT_SECONDS_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .map(std::time::Duration::from_secs)
}

/// The destination arrives as prompt first, entry skill second, each submitted
/// on its own. The order matters: the skill is what the agent must begin with,
/// so it is the last thing typed before the agent starts working.
fn submit_destination<T: PromptDeliveryTmux>(
    delivery: &mut PromptDelivery<T>,
    provider: Provider,
    run_id: &str,
    prompt: &str,
    entry_skill: Option<&str>,
) -> Result<(), PromptDeliveryError> {
    delivery.submit(provider, run_id, prompt)?;
    let Some(skill) = entry_skill else {
        return Ok(());
    };
    delivery.submit(provider, run_id, &entry_skill_invocation(provider, skill))
}

/// Open task sessions for the work item, newest first, restricted to providers
/// whose composer can be observed.
async fn open_sessions(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<Vec<LiveAgentSession>, sea_orm::DbErr> {
    let rows = session::Entity::find()
        .filter(session::Column::TaskId.eq(compact(task_id)))
        .filter(session::Column::Scope.eq("task"))
        .filter(session::Column::TerminatedAt.is_null())
        .filter(session::Column::RuntimeCleanupPending.eq(false))
        .order_by_desc(session::Column::CreatedAt)
        .order_by_desc(session::Column::AgentRunId)
        .all(database)
        .await?;
    Ok(rows.into_iter().filter_map(input_capable).collect())
}

/// A session is input-capable when its provider publishes a ready-composer
/// marker. Without one the backend cannot tell that typed text landed, so such
/// a session is not a handoff target.
fn input_capable(row: session::Model) -> Option<LiveAgentSession> {
    live_agent(row.agent.as_deref(), row.agent_run_id)
}

fn live_agent(agent: Option<&str>, agent_run_id: String) -> Option<LiveAgentSession> {
    let provider = Provider::try_from(agent?).ok()?;
    provider_contract(provider).ready_composer_marker?;
    Some(LiveAgentSession {
        agent_run_id,
        provider,
    })
}

fn runtime_is_live(candidate: &LiveAgentSession) -> bool {
    TmuxAdapter::discover().is_ok_and(|adapter| {
        adapter
            .verify_prompt_session(&candidate.agent_run_id)
            .is_ok()
    })
}

/// Session rows store hyphenless work item identities; decisions carry the
/// canonical form.
fn compact(value: &str) -> String {
    value.replace('-', "")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::Path;
    use std::time::Duration;

    use super::*;
    use ticketry_terminal::DeliveryTimings;

    /// A pane that echoes everything pasted into it below a ready composer, so
    /// readiness and visibility both resolve without a real provider.
    #[derive(Default)]
    struct FakePane {
        buffers: HashMap<String, String>,
        pasted: String,
        calls: Vec<String>,
    }

    impl PromptDeliveryTmux for FakePane {
        fn verify_session(&mut self, _: &str) -> Result<(), String> {
            Ok(())
        }

        fn capture_screen(&mut self, _: &str) -> Result<Vec<u8>, String> {
            Ok(format!("\u{276f} {}", self.pasted).into_bytes())
        }

        fn set_buffer(&mut self, _: &str, buffer: &str, text: &str) -> Result<(), String> {
            self.buffers.insert(buffer.to_owned(), text.to_owned());
            Ok(())
        }

        fn load_buffer(&mut self, _: &str, buffer: &str, path: &Path) -> Result<(), String> {
            let text = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
            self.buffers.insert(buffer.to_owned(), text);
            Ok(())
        }

        fn paste_buffer(&mut self, _: &str, buffer: &str) -> Result<(), String> {
            let text = self.buffers.get(buffer).cloned().unwrap_or_default();
            self.calls.push(format!("paste:{text}"));
            self.pasted.push(' ');
            self.pasted.push_str(&text);
            Ok(())
        }

        fn send_enter(&mut self, _: &str) -> Result<(), String> {
            self.calls.push("enter".to_owned());
            Ok(())
        }
    }

    fn instant() -> DeliveryTimings {
        DeliveryTimings {
            readiness_timeout: Duration::from_secs(1),
            readiness_poll: Duration::ZERO,
            visibility_timeout: Duration::from_secs(1),
            visibility_poll: Duration::ZERO,
            paste_settle: Duration::ZERO,
            completion_settle: Duration::ZERO,
        }
    }

    /// The destination prompt and the entry skill must reach the continued
    /// session as two submissions. One combined paste would deliver the skill
    /// as prose inside the prompt instead of invoking it.
    #[test]
    fn the_prompt_and_the_entry_skill_are_submitted_separately_in_that_order() {
        let mut delivery = PromptDelivery::with_timings(FakePane::default(), instant());

        submit_destination(
            &mut delivery,
            Provider::Claude,
            "run",
            "Destination prompt.",
            Some("tdd"),
        )
        .expect("both submissions land");

        assert_eq!(
            delivery.tmux().calls,
            vec![
                "paste:Destination prompt.".to_owned(),
                "enter".to_owned(),
                "enter".to_owned(),
                "paste:/tdd".to_owned(),
                "enter".to_owned(),
                "enter".to_owned(),
            ]
        );
    }

    /// A destination with no entry skill still delivers its prompt, and types
    /// nothing after it.
    #[test]
    fn a_destination_without_an_entry_skill_submits_only_the_prompt() {
        let mut delivery = PromptDelivery::with_timings(FakePane::default(), instant());

        submit_destination(
            &mut delivery,
            Provider::Claude,
            "run",
            "Only a prompt.",
            None,
        )
        .expect("the prompt lands");

        assert_eq!(
            delivery.tmux().calls,
            vec![
                "paste:Only a prompt.".to_owned(),
                "enter".to_owned(),
                "enter".to_owned(),
            ]
        );
    }

    const SESSIONS: &str = "CREATE TABLE agent_terminal_sessions (
            agent_run_id varchar NOT NULL PRIMARY KEY,
            tmux_session_name varchar NOT NULL,
            task_id varchar NOT NULL,
            module_id varchar NOT NULL,
            project_id varchar NOT NULL,
            created_at varchar NOT NULL,
            terminated_at varchar NULL,
            scope varchar NOT NULL,
            doc_rel_path varchar NULL,
            runtime_cleanup_pending bool NOT NULL DEFAULT 0,
            runtime_namespace varchar(64) NULL,
            output_identity varchar(64) NULL,
            output_sequence bigint NOT NULL DEFAULT 0,
            last_output_at varchar NULL,
            agent varchar NULL
        )";

    const TASK: &str = "1fa3c1b1-143b-4ca2-b31a-9b5db0b839c6";

    async fn sessions(rows: &str) -> DatabaseConnection {
        let database = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        sea_orm::ConnectionTrait::execute_unprepared(&database, SESSIONS)
            .await
            .unwrap();
        if !rows.is_empty() {
            sea_orm::ConnectionTrait::execute_unprepared(&database, rows)
                .await
                .unwrap();
        }
        database
    }

    fn row(agent_run_id: &str, terminated: bool, cleanup: bool, agent: &str) -> String {
        format!(
            "INSERT INTO agent_terminal_sessions VALUES ('{agent_run_id}', 'pt-{agent_run_id}', \
             '1fa3c1b1143b4ca2b31a9b5db0b839c6', 'module', 'project', '2026-09-01T00:00:00Z', {}, \
             'task', NULL, {}, NULL, NULL, 0, NULL, '{agent}');",
            if terminated {
                "'2026-09-01T01:00:00Z'"
            } else {
                "NULL"
            },
            i32::from(cleanup)
        )
    }

    /// A work item with nothing open has nothing to continue, so the caller
    /// falls back to the fresh launch an unchecked edge would have produced.
    #[tokio::test]
    async fn a_work_item_with_no_open_session_offers_no_handoff_target() {
        let database = sessions("").await;

        assert!(open_sessions(&database, TASK).await.unwrap().is_empty());
    }

    /// A terminated session and one queued for runtime cleanup are both gone,
    /// whatever their rows still say.
    #[tokio::test]
    async fn closed_and_cleanup_pending_sessions_are_not_handoff_targets() {
        let database = sessions(&format!(
            "{}{}",
            row("terminated", true, false, "claude"),
            row("cleanup", false, true, "claude")
        ))
        .await;

        assert!(open_sessions(&database, TASK).await.unwrap().is_empty());
    }

    /// The newest open session wins: an agent that moves its own ticket must
    /// be handed the destination in the session it is running in.
    #[tokio::test]
    async fn the_newest_open_input_capable_session_is_the_handoff_target() {
        let database = sessions(&format!(
            "{}{}",
            row("older", false, false, "claude"),
            row("newer", false, false, "claude")
                .replace("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z")
        ))
        .await;

        let candidates = open_sessions(&database, TASK).await.unwrap();

        assert_eq!(
            candidates.first().map(|live| live.agent_run_id.as_str()),
            Some("newer")
        );
    }

    #[test]
    fn a_session_without_a_known_provider_is_not_a_handoff_target() {
        assert!(live_agent(None, "run".to_owned()).is_none());
        assert!(live_agent(Some("not-a-provider"), "run".to_owned()).is_none());
    }

    #[test]
    fn a_provider_with_a_ready_composer_marker_is_a_handoff_target() {
        let live = live_agent(Some("claude"), "run".to_owned()).expect("claude is input capable");

        assert_eq!(live.agent_run_id, "run");
        assert_eq!(live.provider, Provider::Claude);
    }

    #[test]
    fn work_item_identities_are_compacted_to_the_session_storage_form() {
        assert_eq!(
            compact("1fa3c1b1-143b-4ca2-b31a-9b5db0b839c6"),
            "1fa3c1b1143b4ca2b31a9b5db0b839c6"
        );
    }
}
