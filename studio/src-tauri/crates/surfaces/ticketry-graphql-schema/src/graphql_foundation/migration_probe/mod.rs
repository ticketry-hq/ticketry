mod views;

use seaography::Builder;

pub(super) fn register_views(builder: Builder) -> Builder {
    views::register(builder)
}
