mod create;
mod reorder;
mod update;

pub(super) fn register(builder: &mut seaography::Builder) {
    create::register(builder);
    reorder::register(builder);
    update::register(builder);
}
