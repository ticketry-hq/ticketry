# Prevent false terminal loss during launch

Priority: P1. Status: Implemented.

Read the recorded session rows before taking the runtime snapshot. A launch
committed after the snapshot must wait for the next sweep instead of being
judged missing from an older listing. Preserve one listing per sweep.

Acceptance: create and verify live tmux during snapshot acquisition, then commit
the session. This sweep must not end it; the next must report Running without
changing run or tmux identities. Genuinely missing sessions must still become Lost.

Validation: `cargo test --locked --test terminal_reconciliation` passes all 9
tests, including exited cleanup and tombstone recovery. The strengthened race
test fails with `lost` instead of `working` when the old snapshot-first order
is restored, and passes with recorded rows read first. Real tmux requires
running outside the sandbox. Formatting and scoped diff checks pass.

Workflow handoff is blocked: the configured WorkTracker MCP endpoint at
`http://127.0.0.1:8123/mcp` refuses connections. Child inspection, transition
to Review, and `terminate_current_run` could not be performed.
