# Terminal adoption combines schema inspection and snapshot management

Priority: P2. Effort: Medium. Category: Guideline violation and maintainability.

## Evidence

- [studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/persistence/adoption.rs](../../studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/persistence/adoption.rs), line 61, `pub async fn adopt`.
- [studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/persistence/adoption.rs](../../studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/persistence/adoption.rs), line 470, `async fn validate_keys`.
- [studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/persistence/adoption.rs](../../studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/persistence/adoption.rs), line 1094, `fn rotate_snapshot`.

## Why change it

The 1,209-line adoption module handles source classification, migration orchestration, column and key validation, index and foreign-key checks, semantic checks, table digests, snapshot rotation, and evidence-file output. Tests start at line 1,144, so most of the size is implementation. These concerns have separate failure modes and make changes to a sensitive migration path harder to review.

## Smallest useful refactor

Keep adopt and preflight as orchestration. Extract private schema-validation, evidence/digest, and snapshot modules. Preserve validation order, SQL, rollback behavior, and evidence format. Do not replace migration-first ownership with a new repository abstraction or consolidate other capabilities before this local split proves useful.

## Validation

Run terminal adoption, schema drift, preserved-history, and restoration tests. Compare evidence and rejection behavior before and after the move. The first change should be mechanical and introduce no new public exports.
