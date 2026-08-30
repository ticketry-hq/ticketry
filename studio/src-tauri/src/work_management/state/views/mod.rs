mod create;
mod delete;
mod reorder;
mod support;
mod update;

#[cfg(test)]
mod tests;

pub(super) fn register(builder: &mut seaography::Builder) {
    create::register(builder);
    update::register(builder);
    delete::register(builder);
    reorder::register(builder);
}
