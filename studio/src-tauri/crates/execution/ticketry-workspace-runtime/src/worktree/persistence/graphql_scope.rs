use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QuerySelect, QueryTrait};
use seaography::{
    async_graphql::dynamic::ResolverContext, GuardAction, LifecycleHooksInterface, OperationType,
};

use ticketry_entities::{issue, project, ship_record};

const SHIP_RECORDS: &str = "ShipRecords";

/// ShipRecord reads stay scoped to modules the installed authority can see;
/// generated writes are refused outright because the append seam is the only
/// creator and the PR-state trigger is the only updater.
pub struct ShipRecordReadScope;

impl LifecycleHooksInterface for ShipRecordReadScope {
    fn entity_guard(
        &self,
        _ctx: &ResolverContext,
        entity: &str,
        action: OperationType,
    ) -> GuardAction {
        if entity == SHIP_RECORDS && action != OperationType::Read {
            return GuardAction::Block(Some(
                "ship record generated mutations are private".to_owned(),
            ));
        }
        GuardAction::Allow
    }

    fn entity_filter(
        &self,
        _ctx: &ResolverContext,
        entity: &str,
        action: OperationType,
    ) -> Option<Condition> {
        (entity == SHIP_RECORDS && action == OperationType::Read).then(|| {
            Condition::all().add(ship_record::Column::ModuleId.in_subquery(authorized_module_ids()))
        })
    }
}

fn authorized_project_ids() -> sea_orm::sea_query::SelectStatement {
    project::Entity::find()
        .select_only()
        .column(project::Column::Id)
        .into_query()
}

fn authorized_module_ids() -> sea_orm::sea_query::SelectStatement {
    issue::Entity::find()
        .select_only()
        .column(issue::Column::Id)
        .filter(issue::Column::ProjectId.in_subquery(authorized_project_ids()))
        .into_query()
}
