//! SeaORM mappings for terminal persistence.

pub mod cleanup_effect;
pub mod launch_material;
pub mod launch_request_history;
pub mod session;
pub mod viewer_lease;

use crate::entities::runs::agent_run;

/// Register only the generated read models approved for the public graph.
///
/// CODING-865 deliberately leaves this unused by the product schema. The
/// scoped Terminal Session registration belongs to CODING-868; launch material
/// and cleanup effects are internal by design.
pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    // Terminal Session's generated relation needs the existing Agent Run model
    // in the same graph. Its mutation bundle remains private as well.
    seaography::register_entity!(builder, agent_run, mutation: false);
    seaography::register_entity!(builder, session, mutation: false);
    seaography::register_entity!(builder, viewer_lease, mutation: false);
    builder
}

#[cfg(test)]
mod tests {
    use seaography::{Builder, BuilderContext};

    #[tokio::test]
    async fn prepared_registration_builds_generated_reads_without_mutations() {
        let database = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let mut context = BuilderContext::default();
        crate::terminal_persistence::column_policy::apply(&mut context);
        let context = Box::leak(Box::new(context));
        let builder = crate::entities::work_management::register_entity_modules(Builder::new(
            context, database,
        ));
        let schema = super::register_entity_modules(builder)
            .schema_builder()
            .finish()
            .expect("build generated Terminal contract");
        let sdl = schema.sdl();
        assert!(sdl.contains("AgentTerminalSessions"));
        assert!(sdl.contains("AgentRunViewerLeases"));
        assert!(sdl.contains("agentRun"));
        assert!(!sdl.contains("agentTerminalSessionsCreate"));
        assert!(!sdl.contains("agentRunViewerLeasesCreate"));
    }
}
