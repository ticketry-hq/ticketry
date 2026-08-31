//! Resume one ended provider conversation into a new Terminal Session.
//!
//! Generated reads cannot select the newest ended Agent Run per provider
//! conversation while excluding live conversations and successors. The write
//! remains the existing restricted Terminal Session create contract.

mod graphql;
mod operation_registry;
mod query;
mod scope;
mod validation;

pub use query::{ResumableConversationService, RESUMABLE_LIMIT, RESUMABLE_STATEMENT_LIMIT};
pub use validation::validate_resume_request;

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    let registration = &operation_registry::CUSTOM_QUERIES[0];
    debug_assert_eq!(registration.field, "resumable_terminal_sessions");
    debug_assert!(!registration.reason.is_empty());
    debug_assert!(!registration.implementation.is_empty());
    debug_assert!(!registration.parity_test.is_empty());
    debug_assert!(!registration.bounded_test.is_empty());
    graphql::register(builder)
}
