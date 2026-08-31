mod remove_state;

pub(super) fn register(builder: &mut seaography::Builder) {
    remove_state::register(builder);
}
