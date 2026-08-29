mod catalog;
mod module_presentations;
mod operation_registry;
mod patch_input;
mod support;
mod work_items;
mod workflow_configuration;

use super::{commands, entities, read_types};

pub(crate) fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    super::issue_type::apply_generated_input_policy(context);
}

pub(crate) fn register_generated_mutations(builder: seaography::Builder) -> seaography::Builder {
    super::issue_type::register_generated_mutations(builder)
}

pub(crate) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    operation_registry::assert_complete();
    builder.register_custom_mutation::<catalog::CatalogMutations>();
    builder.register_custom_mutation::<module_presentations::ModulePresentationMutations>();
    builder.register_custom_mutation::<work_items::WorkItemMutations>();
    builder.register_custom_mutation::<workflow_configuration::WorkflowConfigurationMutations>();
    builder
}
