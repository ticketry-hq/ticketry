mod create;
mod update;

pub(super) fn register(builder: &mut seaography::Builder) {
    create::register(builder);
    update::register(builder);
}
