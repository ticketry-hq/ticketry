mod catalog;
mod issue_type_contract;
mod patch_input;
mod run_configuration;
mod support;
mod work_items;
mod workflow_configuration;

use super::{commands, entities, read_types};

pub(crate) fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    issue_type_contract::apply_input_policy(context);
}

pub(crate) fn register_generated_mutations(builder: seaography::Builder) -> seaography::Builder {
    issue_type_contract::register(builder)
}

pub(crate) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_mutation::<catalog::CatalogMutations>();
    builder.register_custom_mutation::<work_items::WorkItemMutations>();
    builder.register_custom_mutation::<workflow_configuration::WorkflowConfigurationMutations>();
    builder.register_custom_mutation::<run_configuration::RunConfigurationMutations>();
    builder
}
