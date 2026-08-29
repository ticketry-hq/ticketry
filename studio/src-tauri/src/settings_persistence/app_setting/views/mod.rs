mod update_keybindings;

use seaography::Builder;

pub(super) fn register(builder: &mut Builder) {
    update_keybindings::register(builder);
}
