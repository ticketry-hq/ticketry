//! An accepted launch joins the durable owner of its exact effect.
use super::{execution::LEASE_SECONDS, service::TerminalLaunchService};
use sea_orm::EntityTrait;
use std::time::{Duration, Instant};
use ticketry_entities::{launch_effect, session};
use ticketry_launch::{TerminalLaunchError, TerminalLaunchErrorCode};

impl TerminalLaunchService {
    pub(super) async fn await_dispatch_acknowledgement(
        &self,
        effect_id: &str,
        agent_run_id: &str,
    ) -> Result<session::Model, TerminalLaunchError> {
        let deadline = Instant::now() + Duration::from_secs(LEASE_SECONDS as u64);
        loop {
            let effect = launch_effect::Entity::find_by_id(effect_id)
                .one(&self.database)
                .await
                .map_err(super::service::storage)?;
            match effect {
                Some(effect)
                    if effect.agent_run_id == agent_run_id && effect.state == "applied" =>
                {
                    return self.respond(agent_run_id).await
                }
                Some(effect) if effect.agent_run_id == agent_run_id && effect.state == "leased" => {
                    if Instant::now() >= deadline {
                        return Err(TerminalLaunchError::new(
                            TerminalLaunchErrorCode::EffectBusy,
                            "The launch executor has not settled its bounded lease yet.",
                        ));
                    }
                }
                Some(effect) => {
                    return Err(TerminalLaunchError::new(
                        TerminalLaunchErrorCode::Conflict,
                        effect.last_error_message.unwrap_or_else(|| {
                            "The accepted launch did not settle successfully.".to_owned()
                        }),
                    ))
                }
                None => {
                    return Err(TerminalLaunchError::new(
                        TerminalLaunchErrorCode::Conflict,
                        "The accepted launch effect is unavailable.",
                    ))
                }
            }
            // The database remains the owner across independently composed
            // launch and recovery services. Never steal a live lease or create
            // a second runtime merely because another dispatcher got there first.
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}
