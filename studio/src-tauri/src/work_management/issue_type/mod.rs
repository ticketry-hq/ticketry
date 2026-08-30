mod column_policy;
pub(crate) mod views;
pub(crate) mod workflow;

pub(crate) fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    column_policy::apply(context);
}

pub(crate) fn register_generated_mutations(
    mut builder: seaography::Builder,
) -> seaography::Builder {
    views::register_model_mutations(&mut builder);
    builder
}

pub(crate) fn register_authored_mutations(builder: &mut seaography::Builder) {
    views::register_authored_mutations(builder);
}
