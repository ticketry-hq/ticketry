mod create;
mod delete;
mod payload;
mod support;
mod update;

use seaography::Builder;

pub(super) fn register(mut builder: Builder) -> Builder {
    payload::register(&mut builder);
    create::register(&mut builder);
    update::register(&mut builder);
    delete::register(&mut builder);
    builder
}

#[cfg(test)]
mod tests;
