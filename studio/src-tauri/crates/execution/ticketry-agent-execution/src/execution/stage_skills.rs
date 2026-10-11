//! A continued handoff checks the existing run's provider and directory.
use super::handoff::LiveAgentSession;
use sea_orm::{DatabaseConnection, EntityTrait};
use std::path::PathBuf;
use ticketry_entities::agent_run;
use ticketry_launch::stage_skill_warning;
use ticketry_provider::SkillSearchEnvironment;
use ticketry_runs::RunsServices;

pub(super) async fn record_for_handoff(
    database: &DatabaseConnection,
    live: &LiveAgentSession,
    names: &[String],
) -> Result<(), String> {
    let warning = if names.is_empty() {
        None
    } else {
        let directory = agent_run::Entity::find_by_id(&live.agent_run_id)
            .one(database)
            .await
            .ok()
            .flatten()
            .and_then(|run| run.cwd)
            .filter(|cwd| !cwd.is_empty())
            .map(PathBuf::from);
        let provider = live.provider;
        let environment = SkillSearchEnvironment::from_process();
        let names = names.to_owned();
        let names_on_failure = names.clone();
        let environment_on_failure = environment.clone();
        tokio::task::spawn_blocking(move || {
            stage_skill_warning(provider, directory.as_deref(), &names, &environment)
        })
        .await
        .unwrap_or_else(|_| {
            stage_skill_warning(provider, None, &names_on_failure, &environment_on_failure)
        })
    };
    RunsServices::new(database.clone())
        .lifecycle()
        .set_stage_skill_availability(&live.agent_run_id, warning)
        .await
        .map_err(|error| error.to_string())
}
