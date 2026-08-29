mod clear;
mod set;

use seaography::Builder;

pub(super) fn register(builder: &mut Builder) {
    set::register(builder);
    clear::register(builder);
}
