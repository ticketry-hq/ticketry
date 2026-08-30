//! GraphQL views and reads for the Runs capability.

mod agent_run;
mod automation_attempt;
mod operation_registry;

pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    operation_registry::assert_complete();
    let builder = automation_attempt::register_graphql(builder);
    let builder = agent_run::register_graphql(builder);
    crate::runs_persistence::register_status_graphql(builder)
}

#[cfg(test)]
mod tests;
