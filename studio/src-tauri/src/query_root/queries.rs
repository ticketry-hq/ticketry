use super::mutations;

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_mutation::<mutations::work_management::WorkManagementMutations>();
    builder.register_custom_mutation::<mutations::workflow_configuration::WorkflowConfigurationMutations>();
    builder
}
