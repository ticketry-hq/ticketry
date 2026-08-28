//! The four-operation audit that keeps the Design Document mutation bundle
//! private.
//!
//! Seaography rc.9's `register_entity_mutations` installs create-one,
//! create-batch, update, and delete together; there is no per-operation switch.
//! The bundle is therefore judged as a whole, and one unsafe operation keeps
//! all four private. This module is the written record the governing rules ask
//! for: what each generated operation would do, the exact rc.9 gap that makes
//! it unsafe, and the test that fails if the decision is reversed by accident.
//!
//! Registration lives in [`crate::entities::documents`] as
//! `mutation: false`. The regression tests are
//! `tests/documents_generated_mutation_audit.rs` (what the bundle would expose)
//! and `tests/documents_graphql.rs` (what the production schema actually
//! exposes).

/// One audited generated operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GeneratedMutationFinding {
    /// The generated field the bundle would install.
    pub field: &'static str,
    /// The behaviour Design Documents require that rc.9 cannot run there.
    pub missing_behaviour: &'static str,
    /// The regression test that fails if the bundle becomes public.
    pub regression_test: &'static str,
}

/// Why the whole bundle stays private. Audited together, as rc.9 requires.
pub const FINDINGS: &[GeneratedMutationFinding] = &[
    GeneratedMutationFinding {
        field: "designDocumentsCreateOne",
        missing_behaviour: "A registry row asserts that an authorized design-directory root \
            contains a supported file. Generated create takes the caller's columns, so it would \
            register an unverified root and relative path, and rc.9 has no seam to append the \
            durable document fact in the same transaction as the insert.",
        regression_test: "documents_graphql::generated_design_document_mutations_are_not_public",
    },
    GeneratedMutationFinding {
        field: "designDocumentsCreateBatch",
        missing_behaviour: "Batch create multiplies the same unverified-root problem and cannot \
            be reconciled against the filesystem one row at a time, so a partial discovery would \
            settle as if it were a completed scan.",
        regression_test: "documents_graphql::generated_design_document_mutations_are_not_public",
    },
    GeneratedMutationFinding {
        field: "designDocumentsUpdate",
        missing_behaviour: "rc.9 performs generated update as a bulk statement and runs no \
            pre-save hook (`before_active_model_save` fires on insert only), so a digest-guarded \
            save cannot compare the expected digest, stage and rename the file, and settle the \
            new digest atomically. A filtered update could also re-point many rows at once.",
        regression_test: "documents_graphql::generated_design_document_mutations_are_not_public",
    },
    GeneratedMutationFinding {
        field: "designDocumentsDelete",
        missing_behaviour: "rc.9 runs no delete lifecycle hook, so a generated delete cannot \
            prove the primary file is absent before pruning the row, and cannot append the \
            durable deletion fact in the same transaction.",
        regression_test: "documents_graphql::generated_design_document_mutations_are_not_public",
    },
];

/// The registration this audit produced.
pub const DECISION: &str =
    "design_documents is registered with `mutation: false`; every Design Document write is owned \
     by the Documents application services delivered by later tickets in this slice.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_four_generated_operations_are_audited_with_a_reason_and_a_test() {
        let fields = FINDINGS
            .iter()
            .map(|finding| finding.field)
            .collect::<Vec<_>>();
        assert_eq!(
            fields,
            vec![
                "designDocumentsCreateOne",
                "designDocumentsCreateBatch",
                "designDocumentsUpdate",
                "designDocumentsDelete",
            ]
        );
        for finding in FINDINGS {
            assert!(!finding.missing_behaviour.is_empty());
            assert!(!finding.regression_test.is_empty());
        }
    }
}
