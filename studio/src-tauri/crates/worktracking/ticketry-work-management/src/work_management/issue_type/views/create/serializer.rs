use seaolim::Serializer;

use ticketry_entities::issue_type;

/// Selects Issue Type create rules for this view only.
///
/// The entity lifecycle owns defaults, validation, uniqueness, and ordering
/// because those rules apply to every SeaORM insert. This serializer keeps the
/// generated create view isolated from later Issue Type write views.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct IssueTypeCreateSerializer;

#[sea_orm::prelude::async_trait::async_trait]
impl Serializer<issue_type::ActiveModel> for IssueTypeCreateSerializer {}
