mod operation_registry;
mod patch_input;
mod support;

use super::{commands, read_types};

pub(crate) fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    super::issue_type::apply_generated_input_policy(context);
}

pub(crate) fn register_model_mutations(builder: seaography::Builder) -> seaography::Builder {
    let builder = super::issue_type::register_generated_mutations(builder);
    let builder = super::module_presentation::register_mutations(builder);
    let builder = super::project::register_mutations(builder);
    super::state::register_mutations(builder)
}

pub(crate) use patch_input::{
    GraphqlPatchBool, GraphqlPatchJson, GraphqlPatchString, GraphqlPatchStringList,
};
pub(crate) use support::{
    authoritative_launch_binding, authoritative_project, authoritative_transition,
    authoritative_work_item, command_database, command_error, require_command_database, work_facts,
};
pub(crate) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    operation_registry::assert_complete();
    super::project::register_authored_mutations(&mut builder);
    super::issue_type::register_authored_mutations(&mut builder);
    super::module_presentation::register_authored_mutations(&mut builder);
    super::work_item::register_mutations(&mut builder);
    super::issue_type_transition::register(&mut builder);
    super::issue_type::workflow::register(&mut builder);
    super::launch_binding::register(&mut builder);
    builder
}
