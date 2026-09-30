mod run;

use seaography::Builder;

pub(super) fn register(mut builder: Builder) -> Builder {
    run::register(&mut builder);
    builder
}
