mod create;
mod delete;
mod reorder;
mod update;

use seaography::Builder;

pub(super) fn register(builder: &mut Builder) {
    create::register(builder);
    update::register(builder);
    reorder::register(builder);
    delete::register(builder);
}
