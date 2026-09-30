# Renderer decision test freezes prose and benchmark numbers

Tag: `delete`. Confidence: high.

Location: `scripts/renderer-decision-evidence.test.mjs:1-31`.

This test reads a decision document and matches exact phrases and historical table values such as `134.86 MiB` and `168.42 MiB`. It does not execute renderer selection, inspect a build, or validate the underlying measurements. Rewording the document or updating measurements can fail it while broken renderer behavior passes.

Delete this 31-line test. Keep the decision and measurements in the document and retain `scripts/renderer-comparison-report.test.mjs`, which exercises the report builder. The shipping default belongs in runtime/build contract coverage, not a regex over a historical decision.

Validation: confirm any intended default-selection assertion remains covered in the Ghostty WASM default acceptance tests. Do not replace prose regexes with another snapshot of the same prose.
