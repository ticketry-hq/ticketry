//! Restricted Agent Execution mutation views.
//!
//! Generated writes cannot bind sprint ownership, atomically create the run and
//! snapshot, or fence cancellation against publication. Only these restricted
//! model-shaped create/update seams are public; batch and delete stay private.

mod create;
mod support;
mod update;

use seaography::Builder;

pub(super) fn register(mut builder: Builder) -> Builder {
    create::register(&mut builder);
    update::register(&mut builder);
    builder
}
