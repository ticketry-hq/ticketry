//! Generated-contract mappings for dependency-graph execution.

pub mod graph_run;
pub mod launch_claim;

/// Register the generated, read-only Graph Run graph.
///
/// The launch ledger is intentionally absent. It is internal scheduling state,
/// not a public model graph. Both rc.9 mutation bundles stay private.
///
/// Four-operation audit for each entity:
///
/// | Entity | Create one | Create batch | Update | Delete |
/// | --- | --- | --- | --- | --- |
/// | Graph Run | private: derives scope and policy | private: external fan-out | private: rc.9 skips pre-save | private: reset must serialize |
/// | Launch claim | private: internal scheduling fact | private: internal scheduling facts | private: retry must serialize | private: reset owns cascade |
pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    seaography::register_entity!(builder, graph_run, mutation: false);
    builder
}

#[cfg(test)]
mod tests {
    use crate::entities::runs::agent_run;
    use sea_orm::{EntityName, Iden, Iterable};
    use seaography::{Builder, BuilderContext};

    #[tokio::test]
    async fn generated_contract_keeps_every_execution_write_private() {
        let database = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let context = Box::leak(Box::new(BuilderContext::default()));
        let builder = crate::entities::work_management::register_entity_modules(Builder::new(
            context, database,
        ));
        let mut builder = builder;
        seaography::register_entity!(builder, agent_run, mutation: false);
        let schema = super::register_entity_modules(builder)
            .schema_builder()
            .finish()
            .expect("build generated Execution contract");
        let sdl = schema.sdl();
        assert!(sdl.contains("GraphRuns"));
        assert!(!sdl.contains("LaunchedTasks"));
        assert!(!sdl.contains("launchConfiguration"));
        assert!(!sdl.contains("agentRunId"));
        assert!(!sdl.contains("graphRunsCreate"));
        assert!(!sdl.contains("launchedTasksCreate"));
        assert!(!sdl.contains("launchClaims"));
    }

    #[test]
    fn entity_columns_match_the_adopted_schema() {
        assert_eq!(super::graph_run::Entity.table_name(), "graph_runs");
        assert_eq!(
            super::graph_run::Column::iter()
                .map(|column| column.to_string())
                .collect::<Vec<_>>(),
            [
                "root_id",
                "agent",
                "created_at",
                "updated_at",
                "module_id",
                "project_id",
                "execution_mode",
                "launch_configuration",
            ]
        );
        assert_eq!(super::launch_claim::Entity.table_name(), "launched_tasks");
        assert_eq!(
            super::launch_claim::Column::iter()
                .map(|column| column.to_string())
                .collect::<Vec<_>>(),
            [
                "task_id",
                "claim_id",
                "agent_run_id",
                "launch_effect_id",
                "launch_generation",
                "launched_at",
                "root_id",
            ]
        );
    }
}
