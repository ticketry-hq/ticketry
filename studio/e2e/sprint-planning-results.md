# Integrated planning browser verification

## Verified revision

CODING-2622 complete map: **verified**. Actual Playwright result: **20 passed, 0 failed, 0 skipped, 0 flaky**: ten distinct planning journeys, each with its own passing onboarding case. All seven mapped feature groups pass exact file/title/tag/project checks.

Run `2026-10-08T09-47-28-360Z-e03dcd9b` executed 2026-10-08T09:47:28.361Z through 2026-10-08T09:49:47.739Z (139.378 seconds), exit 0. Checkout: `/Users/karthik/merge_conflicts/ticketry`, HEAD `8fe2404e78352b88eb4232b2d7ca1e13a16328cb` with local changes. This is verification of the integrated working tree, not a new committed revision. Source hashes remained unchanged during execution.

[Immutable summary and all per-case traces/screenshots](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/summary.md) · [Machine results](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/results.json) · [Manifest, commands and cleanup](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/manifest.json) · [Source SHA-256](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/source-sha256.json) · [Tracked working-tree patch](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/working-tree.patch) · [Latest feature results](../../.cursor/skills/verify-ticketry-planning/results/latest.md)

```sh
bun run --cwd studio test:e2e:planning
```

| Feature | Passing required journeys |
| --- | --- |
| Workspace navigation | 3/3 |
| Sprint lifecycle and goals | 5/5 |
| Epic planning | 5/5 |
| Inline Story creation | 2/2 |
| Story moves | 2/2 |
| Suggestion review | 3/3 |
| Background discovery and recovery | 3/3 |

Features overlap; their counts do not sum to the ten distinct journeys. The registry includes the original nine recovered journeys and the integrated suggestion-Undo regression.

## Exact case evidence

Every case directory contains its exact command/environment, Playwright JSON, stdout/stderr, HTML report and both onboarding/journey traces. The immutable summary links all **20 traces and nine screenshots**; all 82 distinct evidence links resolve.

| Case | Result | Evidence |
| --- | --- | --- |
| `agent-review` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-review/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-review/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-review/artifacts/sprint-planning-sprint-goa-37433-freshed-suggestions-persist-chromium/trace.zip) |
| `agent-recovery` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-recovery/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-recovery/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-recovery/artifacts/sprint-planning-cancellati-e0ff8-or-launching-duplicate-runs-chromium/trace.zip) |
| `workspace-create` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/workspace-create/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/workspace-create/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/workspace-create/artifacts/planning-module-manual-wor-923a5-ork-by-keyboard-and-persist-chromium/trace.zip) |
| `manual-moves` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/manual-moves/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/manual-moves/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/manual-moves/artifacts/planning-module-manual-man-d772e-tic-rollback-Retry-and-Undo-chromium/trace.zip) |
| `sprint-lifecycle` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/sprint-lifecycle/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/sprint-lifecycle/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/sprint-lifecycle/artifacts/planning-module-lifecycle--08ff9-ies-only-unfinished-Stories-chromium/trace.zip) |
| `live-completion` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/live-completion/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/live-completion/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/live-completion/artifacts/planning-module-lifecycle--16712--permits-returning-old-work-chromium/trace.zip) |
| `bulk-review` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/bulk-review/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/bulk-review/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/bulk-review/artifacts/planning-module-review-pro-6aab2-l-preserve-goal-attribution-chromium/trace.zip) |
| `story-recovery` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/story-recovery/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/story-recovery/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/story-recovery/artifacts/planning-module-recovery-i-b0a1a-without-creating-duplicates-chromium/trace.zip) |
| `identity-recovery` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/identity-recovery/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/identity-recovery/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/identity-recovery/artifacts/planning-module-recovery-n-6ab0b-sing-the-committed-identity-chromium/trace.zip) |
| `suggestion-undo` | passed | [JSON](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/suggestion-undo/results.json) · [command](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/suggestion-undo/command.json) · [journey trace](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/suggestion-undo/artifacts/sprint-planning-Plan-sugge-508c4--an-accepted-proposal-Story-chromium/trace.zip) |

## Screenshots and isolation

Desktop and 390px layouts were inspected across all nine saved screenshots. Desktop panes and goal attribution are readable; narrow panes stack, the inline editor remains visible, and lifecycle/carryover controls fit. The narrow review header scrolls horizontally. The original focus and page-overflow assertions pass.

- [plan-desktop.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-review/artifacts/sprint-planning-sprint-goa-37433-freshed-suggestions-persist-chromium/plan-desktop.png)
- [plan-narrow.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-review/artifacts/sprint-planning-sprint-goa-37433-freshed-suggestions-persist-chromium/plan-narrow.png)
- [manual-desktop.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/workspace-create/artifacts/planning-module-manual-wor-923a5-ork-by-keyboard-and-persist-chromium/manual-desktop.png)
- [manual-narrow.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/workspace-create/artifacts/planning-module-manual-wor-923a5-ork-by-keyboard-and-persist-chromium/manual-narrow.png)
- [moves-narrow.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/manual-moves/artifacts/planning-module-manual-man-d772e-tic-rollback-Retry-and-Undo-chromium/moves-narrow.png)
- [lifecycle-narrow.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/sprint-lifecycle/artifacts/planning-module-lifecycle--08ff9-ies-only-unfinished-Stories-chromium/lifecycle-narrow.png)
- [bulk-review.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/bulk-review/artifacts/planning-module-review-pro-6aab2-l-preserve-goal-attribution-chromium/bulk-review.png)
- [sprint-recovery.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-recovery/artifacts/sprint-planning-cancellati-e0ff8-or-launching-duplicate-runs-chromium/sprint-recovery.png)
- [sprints-narrow.png](../../.ticketry-dev/planning-results/2026-10-08T09-47-28-360Z-e03dcd9b/agent-recovery/artifacts/sprint-planning-cancellati-e0ff8-or-launching-duplicate-runs-chromium/sprints-narrow.png)

All ten unique disposable SQLite profiles were removed. Every invocation exited 0 and recorded clean cleanup, no cleanup errors, and no forced provider/web-server kills. A final process/tmux check found no owned processes or private tmux sessions. Profiles never use live application data. Artifacts are preserved outside ordinary Playwright cleanup under `.ticketry-dev/planning-results/`; generated profiles, build output and evidence are not committed.

## Supporting verification

```sh
bun run --cwd studio test:overhaul --maxWorkers=1 --minWorkers=1
bun run --cwd studio typecheck
node --test .cursor/skills/verify-ticketry-planning/scripts/results.test.mjs studio/scripts/run-planning-e2e.test.mjs studio/scripts/playwright-profile.test.mjs
```

- Full overhaul command exited 0: Roadmap ON **808 passed in 212 files** (259.79s), Roadmap OFF **19 passed in five files** (10.37s), no unhandled errors. The strict numbered gate covers 584 unique cases. [Final log](../../.ticketry-dev/planning-overhaul-final.log).
- Studio typecheck exited 0. [Log](../../.ticketry-dev/planning-typecheck-final.log).
- Focused strict TypeScript compilation of all restored planning specs/support and Playwright configuration exited 0. [Log](../../.ticketry-dev/planning-e2e-typecheck-final.log).
- Exact-identity reporter, immutable runner and profile ownership checks: **16 passed, zero failed/skipped**. [Log](../../.ticketry-dev/planning-harness-current.log).
- Scoped tracked diff and restored new-file whitespace checks pass.

## Recovery and reconciliation

The supplied `/Users/karthik/merge_conflicts/coding/ticketry` folder does not exist. Before recovery, the original three-file review command reproduced exit 1: no tests found, zero tests in zero files. Five specs, three support files and the executable provider were recovered from the surviving `CODIN-2587-workflow-data-model-path-order-and-per-m` worktree. Behavioral assertions were retained; current setup/profile/HMR adaptations and the supplemental Undo journey are explicit. The unavailable `.cursor` skill/map/runner was reconstructed from executable identities and requirements, not presented as a recovered historical artifact.

Historical CODING-2560 ten-pass evidence was superseded by its own eight-pass/two-failure review. The surviving source report also claimed eighteen passes on 2026-10-05. Neither verifies this checkout, and missing historical artifacts were not reused. The earlier interrupted/failed integrated runs remain historical evidence; the stable run linked above supersedes them for this deliverable.

- [First complete integrated attempt: 15 passed, five failed, changing source](../../.ticketry-dev/planning-results/2026-10-08T09-24-07-923Z-9c7fdd31/summary.md).
- [Second attempt: 19 passed, created-epic focus failed, stable source](../../.ticketry-dev/planning-results/2026-10-08T09-40-20-305Z-5332ee32/summary.md).

Product integration remained owned by scoped findings: CODING-2623–2629 (Undo, public UUIDs, null carryover, focus, completed membership/controls, Changes and gate), CODING-2630–2632 (full-width Plan, inline creation/recovery and proposal review), and CODING-2637–2639 (nested Escape/final-tab/created-epic focus, move focus and sprint-card details). Original browser failures were surfaced and fixed without weakening assertions. The final map verifies their combined behavior. Created-epic focus has a reproduced red and twelve-test green recovery in [its focused log](../../.ticketry-dev/planning-new-epic-focus.log).

## Execution boundary

This runs the real React application and Rust GraphQL adapter. The local executable follows the production Codex exec stdin/schema/result-file contract; Rust owns execution, validation, publication, cancellation and persistence. Public GraphQL supplies fixtures and persisted evidence. Transport fault injection does not fabricate sprint records or execution status. No native Tauri/Ghostty or paid-provider behavior is claimed.
