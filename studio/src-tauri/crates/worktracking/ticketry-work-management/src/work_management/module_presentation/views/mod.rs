mod reorder;
mod update;

pub(super) fn register_model_mutations(builder: &mut seaography::Builder) {
    update::register(builder);
}

pub(super) fn register_authored_mutations(builder: &mut seaography::Builder) {
    reorder::register(builder);
}
