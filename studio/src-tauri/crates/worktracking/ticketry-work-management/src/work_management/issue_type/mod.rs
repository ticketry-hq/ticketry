mod column_policy;
pub mod views;
pub mod workflow;

pub fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    column_policy::apply(context);
}

pub fn register_generated_mutations(mut builder: seaography::Builder) -> seaography::Builder {
    views::register_model_mutations(&mut builder);
    builder
}

pub fn register_authored_mutations(builder: &mut seaography::Builder) {
    views::register_authored_mutations(builder);
}
