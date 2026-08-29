mod create;

use seaography::Builder;

pub(super) fn register(mut builder: Builder) -> Builder {
    create::register(&mut builder);
    builder
}
