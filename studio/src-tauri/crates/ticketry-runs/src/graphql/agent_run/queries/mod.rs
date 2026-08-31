mod holdings;

pub(super) fn register(builder: &mut seaography::Builder) {
    holdings::register(builder);
}
