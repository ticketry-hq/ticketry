//! Replace the text of one goal on an open Sprint.

use seaography::{Builder, OperationType};
use seaolim::{
    register_restricted_model_mutation, string_argument, RestrictedMutationField, ViewSerializers,
};
use ticketry_entities::sprint_goal;

use super::goal_write::GoalWrite;

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<sprint_goal::Entity, sprint_goal::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("update_sprint_goal", OperationType::Update)
            .hook_owns_authorization()
            .argument(string_argument("id"))
            .argument(string_argument("text")),
        GoalWrite::Update,
        ViewSerializers::default(),
    );
}
