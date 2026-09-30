//! Integration tests for the design-document slice.
//!
//! Every file in `tests/` links its own binary against the whole
//! dependency graph, so this crate's integration tests share one.

mod design_document_adoption;
mod design_document_generated_mutation_audit;
mod document_watch;
