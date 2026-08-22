//! Migration-first adoption for durable dependency-graph campaigns.

mod adoption;
mod error;
mod evidence;
mod generated_mutation_audit;
mod inspection;
mod schema;

pub use adoption::{adopt, preflight, AdoptionEvidence, SourceClassification, TableEvidence};
pub use error::{ExecutionPersistenceError, ExecutionPersistenceErrorCode};
pub use schema::{CURRENT_DJANGO_LEAF, VERSION};
