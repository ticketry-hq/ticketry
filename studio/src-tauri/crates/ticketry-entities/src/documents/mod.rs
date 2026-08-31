//! SeaORM mappings for the Documents tables Rust adopts from Django in place.

pub mod design_document;

/// The generated GraphQL object name Seaography derives from
/// `design_documents`. Field policy and the audit tests address the entity by
/// this name, so it is declared once here.
pub const DESIGN_DOCUMENT_OBJECT: &str = "DesignDocuments";

/// Register the generated Design Document read contract.
///
/// `mutation: false` keeps Seaography rc.9's all-or-nothing bundle private.
/// See the documents slice’s `persistence::generated_mutation_audit` for the
/// four-operation audit that decision records.
///
/// The table carries no foreign key: `task_id` also holds the scratch sentinel
/// and `module_id` may be empty on rows a rescan discovered, so there is no
/// relation for Seaography to generate. Reads, filters, ordering, pagination,
/// and outputs are all generated.
pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    seaography::register_entity!(builder, design_document, mutation: false);
    builder
}
