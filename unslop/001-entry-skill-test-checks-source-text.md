# Entry-skill acceptance test checks spelling instead of delivery

Tag: `delete` / `shrink`. Confidence: high.

Location: `studio/src/test/overhaulEntrySkillDeliveryAcceptance.test.tsx:5-39`.

The entire test reads two Rust files and checks for five substrings. It never launches anything or observes submitted text. Those strings can remain in unused code, comments, or the wrong branch while the advertised behavior breaks. Renaming a helper can fail the test without changing behavior.

Replace this case with a Rust test exercising fresh bound launch delivery through a recording adapter. Assert the exact provider-formatted text and failure cleanup. Inspect the existing handoff tests in `studio/src-tauri/crates/execution/ticketry-agent-execution/src/execution/handoff.rs:250` before adding overlapping coverage; those exercise a related delivery path, not necessarily this fresh-launch path.

Remove this 40-line source-spelling test once actual coverage exists. Preserve overhaul gate 245 by linking it to that behavioral case and updating the gate documentation.

Validation: changing delivered text or skipping submission must fail the replacement test; renaming the internal helpers must not.
