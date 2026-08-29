//! Hand-authored SeaORM mappings for tables owned and migrated by Django.

pub mod agent_model;
pub mod agent_model_reasoning_level;
pub mod attachment;
pub mod issue;
pub mod issue_blocker;
pub mod issue_type;
pub mod issue_type_transition;
pub mod launch_binding;
pub mod launch_policy_decision;
pub mod launch_policy_rejection;
pub mod module_presentation;
pub mod project;
pub mod provider;
pub mod reasoning_level;
pub mod state;
pub mod transition_occurrence;

/// Register the generated WorkTracker read graph. Audited writes are installed
/// separately by `work_management::graphql`, one operation at a time; every
/// other generated mutation remains private.
pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    seaography::register_entity!(builder, project, mutation: false);
    seaography::register_entity!(builder, state, mutation: false);
    seaography::register_entity!(builder, issue_type, mutation: false);
    seaography::register_entity!(builder, issue, mutation: false);
    seaography::register_entity!(builder, module_presentation, mutation: false);
    seaography::register_entity!(builder, issue_blocker, mutation: false);
    seaography::register_entity!(builder, attachment, mutation: false);
    seaography::register_entity!(builder, issue_type_transition, mutation: false);
    seaography::register_entity!(builder, launch_binding, mutation: false);
    seaography::register_entity!(builder, provider, mutation: false);
    seaography::register_entity!(builder, agent_model, mutation: false);
    seaography::register_entity!(builder, agent_model_reasoning_level, mutation: false);
    seaography::register_entity!(builder, reasoning_level, mutation: false);
    builder
}
