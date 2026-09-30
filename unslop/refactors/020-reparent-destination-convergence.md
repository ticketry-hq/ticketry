# Refresh both modules after a sidebar move

Priority: P2. Status: Implemented.

Derive the destination module from the authoritative reparent response and
include it with the source modules in the scoped refresh. Only mark the
mutation converged after both lists refresh.

Acceptance: move a leaf Story through the sidebar to another cached module,
then verify destination membership and source removal. Cover a caller that
supplies only the source module and run the overhaul gate.

Validation: acceptance case 285 verifies the sidebar path and both cached
lists. The transport regression supplies only the source module and passes.
See [validation](REVIEW-IMPLEMENTATION.md).
