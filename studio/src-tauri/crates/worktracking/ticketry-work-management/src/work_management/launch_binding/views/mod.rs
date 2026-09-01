mod upsert;

pub(super) fn register(builder: &mut seaography::Builder) {
    upsert::register(builder);
}
