mod list;

pub(super) fn register(builder: &mut seaography::Builder) {
    list::register(builder);
}
