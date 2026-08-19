//! Central Design Document column policy for the generated GraphQL contract.
//!
//! Protection is declared once and applied two ways, so no later registration
//! change can quietly widen the contract:
//!
//! 1. `root_dir` and `discovered_by_run_id` carry `#[seaography(ignore)]` on the
//!    entity. That is structural, not conditional: it removes them from the
//!    entity object, filters, ordering, and every generated input at once, so
//!    an absolute authorized root and a run's provenance are simply not part of
//!    the public contract.
//! 2. Every adopted column — those two included — is skipped in the generated
//!    insert and update inputs. The policy holds even though the entity is
//!    registered with `mutation: false`, so flipping that registration cannot
//!    silently expose a server-owned identity, scope, timestamp, or digest.
//!
//! Names are resolved through the context's own naming functions rather than a
//! second copy of Seaography's casing rule, so the policy cannot drift from the
//! contract it protects.

use sea_orm::{EntityName, IdenStatic, Iterable};
use seaography::BuilderContext;

use crate::entities::documents::design_document;

use super::ownership_manifest::PROTECTED_COLUMNS;

/// Install the Design Document generated-input policy into the shared builder
/// context.
pub fn apply(context: &mut BuilderContext) {
    for name in protected_input_names(context) {
        context.entity_input.insert_skips.push(name.clone());
        context.entity_input.update_skips.push(name);
    }
}

/// `"<TypeName>.<fieldName>"` for every protected column.
pub(crate) fn protected_input_names(context: &BuilderContext) -> Vec<String> {
    let type_name = (context.entity_object.type_name)(design_document::Entity.table_name());
    design_document::Column::iter()
        .filter(|column| PROTECTED_COLUMNS.contains(&column.as_str()))
        .map(|column| {
            let field = (context.entity_object.column_name)(&type_name, column.as_str());
            format!("{type_name}.{field}")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_every_manifest_column_including_the_two_internal_authorities() {
        let context = BuilderContext::default();
        let names = protected_input_names(&context);

        assert_eq!(names.len(), PROTECTED_COLUMNS.len());
        for expected in [
            "DesignDocuments.id",
            "DesignDocuments.moduleId",
            "DesignDocuments.taskId",
            "DesignDocuments.scope",
            "DesignDocuments.rootDir",
            "DesignDocuments.relPath",
            "DesignDocuments.discoveredByRunId",
            "DesignDocuments.createdAt",
            "DesignDocuments.updatedAt",
            "DesignDocuments.contentDigest",
        ] {
            assert!(names.contains(&expected.to_owned()), "missing {expected}");
        }
    }

    #[test]
    fn the_object_name_matches_the_one_the_audit_addresses() {
        let context = BuilderContext::default();
        assert_eq!(
            (context.entity_object.type_name)(design_document::Entity.table_name()),
            crate::entities::documents::DESIGN_DOCUMENT_OBJECT
        );
    }
}
