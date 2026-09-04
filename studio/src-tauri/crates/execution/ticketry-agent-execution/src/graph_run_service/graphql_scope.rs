use sea_orm::{ColumnTrait, Condition, EntityTrait, QuerySelect, QueryTrait};
use seaography::{
    async_graphql::dynamic::ResolverContext, GuardAction, LifecycleHooksInterface, OperationType,
};

use ticketry_entities::{graph_run, issue, project};

const GRAPH_RUNS: &str = "GraphRuns";

/// Marks a request as coming through Ticketry's local, authenticated TauRPC
/// endpoint. The installed application has one Project authority.
#[derive(Clone, Copy)]
#[doc(hidden)]
pub struct GraphRunCaller;

pub struct GraphRunReadScope;

impl LifecycleHooksInterface for GraphRunReadScope {
    fn entity_guard(
        &self,
        ctx: &ResolverContext,
        entity: &str,
        action: OperationType,
    ) -> GuardAction {
        if entity != GRAPH_RUNS {
            return GuardAction::Allow;
        }
        if action != OperationType::Read {
            return GuardAction::Block(Some("Graph Run generated mutations are private.".into()));
        }
        if ctx.data_opt::<GraphRunCaller>().is_none() {
            return GuardAction::Block(Some("Graph Run caller authority is required.".into()));
        }
        GuardAction::Allow
    }

    fn entity_filter(
        &self,
        _ctx: &ResolverContext,
        entity: &str,
        action: OperationType,
    ) -> Option<Condition> {
        (entity == GRAPH_RUNS && action == OperationType::Read).then(|| {
            Condition::all()
                .add(graph_run::Column::ProjectId.in_subquery(authorized_project_ids()))
                .add(graph_run::Column::RootId.in_subquery(authorized_root_ids()))
        })
    }
}

fn authorized_project_ids() -> sea_orm::sea_query::SelectStatement {
    project::Entity::find()
        .select_only()
        .column(project::Column::Id)
        .into_query()
}

fn authorized_root_ids() -> sea_orm::sea_query::SelectStatement {
    issue::Entity::find()
        .select_only()
        .column(issue::Column::Id)
        .into_query()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};
    use seaography::{Builder, BuilderContext, LifecycleHooks};

    #[tokio::test]
    async fn generated_read_refuses_a_request_without_caller_authority() {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        database
            .execute_unprepared(
                "CREATE TABLE worktracker_project (id TEXT PRIMARY KEY); \
                 CREATE TABLE worktracker_issue (id TEXT PRIMARY KEY); \
                 CREATE TABLE graph_runs (root_id TEXT PRIMARY KEY, agent TEXT, \
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL, module_id TEXT, \
                   project_id TEXT NOT NULL, execution_mode TEXT NOT NULL, launch_configuration TEXT);",
            )
            .await
            .unwrap();
        let mut context = BuilderContext::default();
        context.hooks = LifecycleHooks::new(super::GraphRunReadScope);
        let context = Box::leak(Box::new(context));
        let builder = ticketry_entities::register_work_management_entities(Builder::new(
            context,
            database.clone(),
        ));
        let builder = ticketry_terminal::register_persistence_graphql(builder);
        let schema = ticketry_entities::register_execution_entities(builder)
            .schema_builder()
            .data(database)
            .finish()
            .unwrap();

        let response = schema.execute("{ graphRuns { nodes { rootId } } }").await;
        assert_eq!(response.errors.len(), 1);
        assert!(response.errors[0]
            .message
            .contains("caller authority is required"));
    }
}
