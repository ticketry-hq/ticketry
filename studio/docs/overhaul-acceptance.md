# Studio overhaul acceptance gate

The twenty-three checks that were once a manual pre-merge walk are automated by
`npm run test:overhaul --workspace @worktracker/studio`. Desktop CI runs that
named gate before the full Studio suite, typecheck, and build.

| Case | Automated behavior |
| --- | --- |
| 01 | Field, type, and parent changes repaint the Stories and Details surfaces. |
| 02 | A workflow-state change moves the Story to the new section. |
| 03 | A dragged Story keeps its authoritative post-reply position. |
| 04 | A refused write visibly rolls back. |
| 05 | An external/agent edit repaints the open UI without reload. |
| 06 | Selection cycles through loaded records without a loading flash. |
| 07 | A collapsed branch retains descendant activity chicklets. |
| 08 | The keyboard live-terminal cycle enters collapsed branches. |
| 09 | An externally killed terminal remains as a dead tab. |
| 10 | A closed terminal stays dismissed after server reconciliation. |
| 11 | An unsaved document buffer survives tab switches. |
| 12 | Reload restores sidebar, panel layout, expansion, and collapsed sections. |
| 13 | A module scratch workspace launches and displays its run summary. |
| 14 | Reconnect replay closes a missed-membership gap without duplication. |
| 15 | Switching projects cannot let a stale status snapshot mark a connected run exited. |
| 16 | A dormant provider session resumes into a newly selected terminal tab. |
| 17 | Fresh provider onboarding saves an activated provider and global launch default. |
| 18 | The work-item pane boundary exposes an accessible draggable separator. |
| 19 | Workflow settings derive state-delete blockers from canonical resources. |
| 20 | The dialog bus renders confirmation requests and resolves both user choices. |
| 21 | Repeating Run subtree revives an inactive campaign from the same action. |
| 22 | Settings cold-opens from the footer and loads the selected project catalog. |
| 23 | A task launches Codex Chat beside Terminal; renders Markdown, reasoning, MCP arguments/results, token usage, plans, patches, and durable delivery states; retries transport-uncertain delivery with the same command identity while failing closed on a restart-ambiguous delivery until the resumed thread is reviewed; answers only provider-advertised structured choices; distinguishes turn stop/failure from process Resume; and authoritatively stops through an independent REST path even while a live turn acknowledgement is pending before safely closing/reopening without creating a terminal session. |

Each executable case carries one stable `[overhaul-NN]` marker. The gate has a
contract test that fails if a marker is missing or duplicated. When a Studio UI
change affects one of these behaviors, update that case in the same change. If
the change introduces a new durable user behavior, add a new acceptance case
and extend this matrix rather than returning to a manual checklist.

## Real-browser web gate

`npm run test:e2e:overhaul --workspace @worktracker/studio` starts the browser
development stack with a temporary SQLite profile and drives Chromium through
the visible Studio UI. The Playwright cases live in `studio/e2e/overhaul.spec.ts`.
The temporary profile and its tmux socket are removed when the run exits.

Cases that require a real coding-agent process, a tmux session killed from
outside Studio, or repository-backed documents remain explicitly skipped in
the web suite. They must not be counted as automated until the harness has safe
fixture support for those boundaries; their existing Vitest cases are not a
substitute for running-application verification.

In particular, `[overhaul-web-23]` is an explicit skip: it requires launching a
real full-access `codex app-server` process and exercising the browser-to-server
WebSocket. The `[overhaul-23]` Vitest acceptance case validates the UI contract
with a deterministic provider stream, but is not claimed as real-backend E2E.
