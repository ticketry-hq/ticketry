mod create;
mod delete;
mod reorder;
mod update;

#[cfg(test)]
mod tests;

pub(super) fn register_model_mutations(builder: &mut seaography::Builder) {
    create::register(builder);
    update::register(builder);
    reorder::register(builder);
}

pub(super) fn register_authored_mutations(builder: &mut seaography::Builder) {
    delete::register(builder);
}
