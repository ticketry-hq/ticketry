mod column_policy;
pub(crate) mod views;

pub(crate) fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    column_policy::apply(context);
}

pub(crate) fn register_generated_mutations(
    mut builder: seaography::Builder,
) -> seaography::Builder {
    views::register(&mut builder);
    builder
}
