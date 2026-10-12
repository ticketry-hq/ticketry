mod create;
mod delete;
mod goal_write;
mod update;

pub(super) fn register(builder: &mut seaography::Builder) {
    create::register(builder);
    update::register(builder);
    delete::register(builder);
}
