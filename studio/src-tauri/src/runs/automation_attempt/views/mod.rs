mod dismiss;
mod retry;

pub(super) fn register(builder: &mut seaography::Builder) {
    retry::register(builder);
    dismiss::register(builder);
}
