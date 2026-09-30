mod update_instant_launch;
mod update_keybindings;

use seaography::Builder;

pub(super) fn register(builder: &mut Builder) {
    update_instant_launch::register(builder);
    update_keybindings::register(builder);
}
