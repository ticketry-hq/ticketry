use seaolim::Serializer;

use ticketry_entities::sprint;

/// Selects Sprint create rules for this view only.
///
/// The entity lifecycle owns identity, project scope, the `planned` status,
/// defaults, and validation because those rules apply to every SeaORM insert.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct SprintCreateSerializer;

#[sea_orm::prelude::async_trait::async_trait]
impl Serializer<sprint::ActiveModel> for SprintCreateSerializer {}
