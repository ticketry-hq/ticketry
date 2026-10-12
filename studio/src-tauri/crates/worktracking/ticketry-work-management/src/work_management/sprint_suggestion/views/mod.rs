mod update;

pub(super) fn register(builder: &mut seaography::Builder) {
    update::register(builder);
}
