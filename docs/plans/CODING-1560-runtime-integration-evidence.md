# CODING-1560 runtime integration

The task has no Implementation children. Integration completed in the shared
workspace without reverting existing campaign changes.

## Changes

- Desktop and browser-development MCP use the selected data directory's
  `mcp.sock`. Startup rejects a guard belonging to another directory before
  opening the database or reclaiming a socket.
- The developer adapter handles SIGINT/SIGTERM and closes MCP connections and
  removes its socket before releasing directory ownership. Browser GraphQL
  retains its separate transport.
- Removed MCP port allocation, overrides, HTTP provider smoke calls, and stale
  guidance. Browser E2E uses an explicit isolated socket profile with cleanup.
- Desktop smoke holds ports 8123 through 8132 and drives the configured packaged
  stdio bridge. Concurrent development fixtures use distinct Unix sockets.
- Acceptance cases 35 and 174 cover readiness/restoration identities and the
  visible MCP failure warning. Case 156 matches existing recovery copy. The
  numbered gate documentation is updated.

## Verification

Passed:

- `cargo test -p ticketry-mcp -p ticketry-launch -p ticketry-desktop`, including
  a desktop socket MCP ping while ports 8123 through 8132 are occupied.
- Developer adapter tests: 28.
- Root MCP acceptance: 7; Agent Run lifecycle: 6; terminal reconciliation: 9.
- Integrated Node script checks: 34.
- Targeted Studio acceptance: 3 files, 9 tests.
- Full desktop-acceptance and Cargo hook builds, architecture checks, TypeScript,
  and Vite build. The real desktop answered socket `mcp_ping` while all ten
  obsolete ports were occupied.
- `git diff --check`.

Broader workspace gates are not green:

- Full desktop smoke passes socket ping, a gated `list_projects` read,
  onboarding setup, and module creation. After clicking `onboarding-skip-tour`,
  it returns to the welcome screen and cannot capture a Story. Full provider
  launch/restoration remains unverified. The completed readiness receipt and
  startup trace are captured in ignored
  `studio/test-results/desktop-agent-acceptance-1788836910116/`.
  Earlier attempts exposed the existing shell-before-recovery race; the smoke
  now waits for a successful gated read instead of treating ping as readiness.

- Full overhaul final run: 437 passed, 2 failed, 2 unhandled errors. Failures
  are Launchkey case 255 and native-render recovery diagnostics. Agent Run
  visibility case 186 also lacks the `WorkItemEndedRuns` fixture response.
- Public API boundary fixture omits `ticketry-work-management::begin_write`.
  This integration added no public exports.
- Terminal output activity: 4 passed, 11 failed. The fixture lacks
  `initial_prompt`, `launch_reasoning`, and `launch_unattended` columns selected
  by the Agent Run model. Both sides of the mismatch already exist at HEAD.
- Shipping caller gate still flags existing browserRuntime/vite.proxy transport
  checks. The obsolete MCP TCP requirement has been removed.

Socket-binding tests required local socket permissions outside the sandbox.
