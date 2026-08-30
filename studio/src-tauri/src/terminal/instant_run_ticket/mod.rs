//! Safe ticket-shaped projections for active taskless Instant conversations.
//!
//! Launch material stays private because it contains filesystem context and
//! agent instructions. This capability publishes only a title derived from
//! the user's request plus the existing Agent Run identity and start time.

mod graphql;
mod operation_registry;
mod query;
mod title;

use seaography::CustomOutputType;
use serde::Serialize;

pub use query::{InstantRunTicketQuery, INSTANT_RUN_TICKET_LIMIT};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct InstantRunTicket {
    pub agent_run_id: String,
    pub title: String,
    pub started_at: String,
}

pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    operation_registry::assert_complete();
    graphql::register(builder)
}
