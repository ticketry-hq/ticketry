mod create;
mod delete;
mod support;
mod update;

use seaography::Builder;

pub(super) fn register(mut builder: Builder) -> Builder {
    create::register(&mut builder);
    update::register(&mut builder);
    delete::register(&mut builder);
    builder
}
