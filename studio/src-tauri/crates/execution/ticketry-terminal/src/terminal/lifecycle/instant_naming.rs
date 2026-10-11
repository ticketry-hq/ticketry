//! Recover the immutable naming source from the already prepared launch effect.
use sea_orm::{DatabaseConnection, EntityTrait};
use ticketry_entities::{launch_effect, launch_material};
use ticketry_launch::ExecutionAuthority;

pub(super) async fn attach_source(
    database: &DatabaseConnection,
    material: &launch_material::Model,
    execution: ExecutionAuthority,
) -> ExecutionAuthority {
    if material.provider.as_deref() != Some("codex")
        || material.scope != "instant"
        || material.resume_from_agent_run_id.is_some()
    {
        return execution;
    }
    // Source metadata is cosmetic. A missing effect/read keeps the policy's
    // safe no-request behavior rather than blocking the user's launch.
    let reference = launch_effect::Entity::find_by_id(&material.effect_id)
        .one(database)
        .await
        .ok()
        .flatten()
        .and_then(|effect| effect.policy_reference);
    execution.with_codex_instant_policy_reference(reference.as_deref())
}
