mod observe_output;

use seaography::Builder;

pub(super) fn register(mut builder: Builder) -> Builder {
    observe_output::register(&mut builder);
    builder
}
