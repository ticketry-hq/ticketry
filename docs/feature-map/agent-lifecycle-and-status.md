# Agent lifecycle and status

Work-item, conversation, terminal and module indicators present durable agent activity, automation delivery and actionable failures through one live status subscription.

Surfaces: browser, desktop, manual
Editions: pocock, core

## Sub-features

- `agent-lifecycle-state-badges`: Work-item and scratch-run chips, provider-aware running counts and terminal lifecycle labels.
- `agent-lifecycle-module-chips`: Module tab and Module Manager agent counts scoped to that module.
- `agent-lifecycle-automation-delivery`: Latest delivered transition distinguishes an existing session from a fresh launch.
- `agent-lifecycle-automation-failure-retry`: Failed automation attempts expose their reason and permit eligible retries.
- `agent-lifecycle-claude-startup-attention`: Passive startup attention opens the original Claude terminal for a human decision.
- `agent-lifecycle-status-stream`: Snapshot, replay, reconnect and reset keep the selected project's Apollo holdings current.

## How to get to it

- Start a run through [Agent launch](agent-launch.md), then inspect its Stories row, selected terminal tab and module tab. Module Manager rows also contain module lifecycle chips; see [Module Manager](module-manager.md). Instant conversation rows carry their own lifecycle indicator; see [Conversations](conversations.md).
- Automated workflow transitions can add delivery and failure chips beside the affected work item; collapsed parents can roll up descendant attempts. Click **Retry** through the button named **Retry failed automated launch**. These status/retry controls have no default keyboard chord.
- For qualifying Claude startup attention, click **Open terminal**. Its accessible name is the complete reason, either **Claude is waiting for folder trust. Open its terminal to approve or decline.** or **Claude startup needs attention. Open its terminal to continue.** It dispatches the `focus-agent-run` action with the existing run ID; that payload action has no default keyboard chord. Approval or refusal happens in the terminal, not on the chip.
- The status feed starts for the selected project automatically. Returning the window/page to visible or bringing it online replaces the subscription; there is no separate status-stream screen or reconnect button.

## Prerequisites

- A selected project and runs/automation attempts in its status holding. Empty holdings intentionally produce no agent chips. Module chips need matching module identity; scratch chips additionally need matching project identity and Plan/Instant scope.
- Actual agent lifecycle execution requires working launch services, a linked/trusted module folder and a provider executable. The desktop harness requires the desktop build; the browser feature suite also uses the approved disposable Codex-compatible provider. Component/status tests inject durable frames and require no provider.
- To inspect failure/retry, use an isolated failed Automation Attempt. Retry is allowed only when its authoritative `retryable` flag permits it, with no pending attempt on the displayed subtree. A working status transport is required; browser development has that transport through the Rust GraphQL adapter.

## Expected behavior

- Work-item `agent-state-badge` exposes aggregate `data-state` (`active`, `attention` or `idle`) and state/count chips for the item and supplied descendants. `scratch-run-chicklets` counts live Plan/Instant runs in its module. Starting/working chips split by provider; other states use their lifecycle palette. Exited/lost history and agentless shells do not count as active task/module agent activity; unknown states render no lifecycle label. Module chips specifically include error, needs-input, permission-required and working runs, rather than every task badge state (`selectors.ts`).
- Terminal labels distinguish **Working**, **Needs input**, **Permission required**, **Done**, **Quiet**, **Stalled**, **Reconnecting**, **Exited**, **Session lost** and **Error**. **Done** means the agent finished its turn and awaits the user; it is not proof the WorkItem reached Done. **Stalled** means unchanged output for 60 seconds while the session is live. Terminal outcomes and explicit waiting-for-user states outrank this heuristic; changed output restores the latest provider state (`terminal/lifecycle.ts`, `status/runPresentation.ts`).
- `automation-delivery-chicklet` carries `data-delivery-mode="continued"` and **Continued**, or `started_fresh` and **Fresh**, selected from the newest delivered attempt across the displayed subtree. Pending undelivered attempts and ordinary launches with no automation lineage show no delivery chip. Continued delivery does not mint a fresh run (`status/automationDelivery.ts`). The chip survives reload: `automation_attempts` and the `run_status_stream` snapshot keep each lineage's newest attempt while it is unresolved, and keep a settled success only when it recorded a delivery mode, so reload rebuilds the chip from durable attempts rather than from in-session events (`ticketry-runs` `persistence/attempt_queries.rs`, CODING-2765).
- `automation-failure-chicklet` shows failed count and error reasons in its title. Retry targets eligible failed attempts, stops row-click propagation and disables further requests while local retry or a subtree attempt is pending. Text becomes **Retrying…**, **Retry failed** on rejection, or disabled **Fix required** for nonretryable failures. A successful retry response immediately updates the Apollo attempt holding; later stream facts reconcile it. A launch failure does not itself roll the committed WorkItem state back; see the [one-live-agent ADR](../../studio/docs/adr/0013-one-live-agent-per-work-item-decided-by-the-edge.md).
- Claude attention remains passive until clicked. Its action focuses or reattaches the existing run; it does not launch another agent or manufacture trust approval. Generic startup attention is distinct from the folder-trust reason (`ClaudeStartupAttentionAction.tsx`; acceptance cases 392–395).
- The feed reads typed `run_status_stream` snapshots and committed events, retains a monotonic cursor per project and excludes superseded/foreign-project frames. Reconnect retries use exponential backoff (1-second base, 15-second base cap, plus jitter). Online/visibility recovery replaces the subscription. Reload starts a fresh snapshot with a unique subscription identity. A refused replay baseline causes canonical refresh before accepting the reset cursor; failed refresh retries without baselining stale holdings. A WorkItem entity or module-collection refresh that fails (for example while offline) stays owed and is retried at the next flush, at the latest the reconnect's caught-up boundary, because the cursor advances independently of the failed read; a reset or project switch drops owed reads because the reset refetches every canonical holding (`stream/workItemInvalidation.ts`, CODING-2764). Run discovery, work-item/workflow refresh and related terminal/document/worktree invalidation converge through Apollo (`statusStreamClient.ts`, `stream/statusStreamFeed.ts`, `stream/authoritativeReset.ts`).

## Verifying it

Browser feature cases live in `studio/e2e/features/agent-lifecycle-and-status.spec.ts`;
only passing runner evidence verifies the cells below.

- Stable observations: `agent-state-badge[data-state="active"]`, `scratch-run-chicklets`, `automation-delivery-chicklet[data-delivery-mode]` and `automation-failure-chicklet`. Module chips have no dedicated test ID: scope to the module tab (`button[role="tab"][aria-label="Acceptance Module"]` in the desktop fixture), then query **Agent is actively working**, **Agent is waiting for your input**, **A permission decision is pending** or **Agent session reported an error**. Use the terminal lifecycle accessible descriptions, not provider colors, as the state assertion.
- Lifecycle projection: `studio/src/test/overhaulTerminalLifecycleAcceptance.test.tsx` cases **09**, **10**, **15**, **36**, **137**, **138** cover lost/dismissed/restored and attention/completion paths; `studio/src/test/overhaulTerminalStallAcceptance.test.tsx` case **139** covers silent-live stall/recovery; `studio/src/test/overhaulTerminalOutcomeAuthorityAcceptance.test.tsx` cases **140**, **141**, **238** cover authoritative outcomes. Narrow command: `bun run --cwd studio test -- src/test/overhaulTerminalLifecycleAcceptance.test.tsx src/test/overhaulTerminalStallAcceptance.test.tsx src/test/overhaulTerminalOutcomeAuthorityAcceptance.test.tsx`.
- Run/module isolation: `studio/src/test/overhaulInstantTicketsAcceptance.test.tsx` case **311**; run `bun run --cwd studio test -- src/test/overhaulInstantTicketsAcceptance.test.tsx -t 'overhaul-311'`. Provider grouping: `studio/src/features/agents/status/lifecycleChipProvider.test.ts`; run `bun run --cwd studio test -- src/features/agents/status/lifecycleChipProvider.test.ts`.
- Durable delivery listing: `studio/src-tauri/tests/automation_attempts.rs`, **delivered_successes_stay_listed_while_undelivered_successes_resolve**; run `cargo test --manifest-path studio/src-tauri/Cargo.toml --test automation_attempts`.
- Delivery: `studio/src/test/overhaulAutomationDeliveryAcceptance.test.tsx` cases **250**, **236b**; run `bun run --cwd studio test -- src/test/overhaulAutomationDeliveryAcceptance.test.tsx`. Retry writer/refusals: `studio/src/features/agents/status/retryAutomationAttempt.test.ts`; run `bun run --cwd studio test -- src/features/agents/status/retryAutomationAttempt.test.ts`. This tests the mocked transport mutation, not a successful provider retry through the rendered button.
- Claude: `studio/src/test/overhaulClaudeTrustAttentionAcceptance.test.tsx` cases **392–395** test passive attention, reason distinction and existing task/Plan/Instant terminal focus/reattach; run `bun run --cwd studio test -- src/test/overhaulClaudeTrustAttentionAcceptance.test.tsx`.
- Status: `studio/src/test/overhaulStatusStreamConsumerAcceptance.test.tsx` cases **82**, **82b**, **82c**, **229**, **266**, **268**, **275**, **278**, plus refused-subscription recovery, cover convergence and browser subscription/failure display. Run `bun run --cwd studio test -- src/test/overhaulStatusStreamConsumerAcceptance.test.tsx`. Offline WorkItem refresh retry at reconnect: `studio/src/features/agents/status/stream/statusStreamFeed.test.ts`, **retries a canonical refresh that failed offline once the reconnect catches up**; run `bun run --cwd studio test -- src/features/agents/status/stream/statusStreamFeed.test.ts`. Reset failure/buffer ordering is covered in `studio/src/features/agents/status/stream/authoritativeReset.test.ts`; run `bun run --cwd studio test -- src/features/agents/status/stream/authoritativeReset.test.ts`.
- All numbered cases above belong to `bun run --cwd studio test:overhaul`, which also runs the Pocock edition acceptance configuration (`studio/vitest.pocock.config.ts`). Component success proves rendering/projection with controlled frames, not provider execution.
- Authored desktop coverage: `studio/scripts/desktop-agent-acceptance.mjs`, documented in [desktop agent acceptance](../../studio/e2e-desktop/README.md); narrow available command is `bun run --cwd studio test:e2e:desktop` (one combined scenario). Its disposable Codex-compatible executable drives the real Rust launch, tmux, MCP and hook lifecycle; checks active task/module/terminal indicators, Implement→Review→Done, module aggregate clearing, reload and same-profile desktop application restart. Its stale setup is described in Gotchas; no current passing run is claimed here. It never calls a paid provider or model API.
- Browser replay: `studio/e2e/features/ticket-details.spec.ts`, **overhaul-web-14**, observes an offline external WorkItem rename converge after reconnection. Run `bun run --cwd studio test:e2e e2e/features/ticket-details.spec.ts --project chromium --grep '@case-overhaul-web-14'`. Vitest guard: `studio/src/test/overhaulOfflineEditGapAcceptance.test.tsx` (canonical reads failed offline are retried at caught-up). This is status-driven WorkItem convergence, not agent/provider lifecycle execution.
- Browser delivery presentation: `studio/e2e/web-app.spec.ts`, **says whether an automated transition continued a session or started a fresh one**, intercepts `/graphql/subscribe` with delivered-attempt snapshots and checks Continued, Fresh and absent chips on Story rows. Run `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'says whether an automated transition'`. This proves intercepted subscription-to-row presentation, not real handoff or provider execution; it inherits the stale shared module setup caveat below.
- Missing coverage: no identified rendered retry-button success/error acceptance or provider retry end-to-end scenario; no paid-provider or real Claude startup-prompt end-to-end proof. Those paths are source-grounded here and require separate disposable/manual evidence. No behavioral execution result is asserted by this map entry.

## End-to-end suite

Suite: studio/e2e/features/agent-lifecycle-and-status.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `agent-lifecycle-state-badges` | @case-lifecycle-provider-status | n/a: Read-only lifecycle indicators have no cancel action. | @case-lifecycle-automation-retry | @case-lifecycle-empty | @case-lifecycle-provider-status | @case-lifecycle-provider-status |
| `agent-lifecycle-module-chips` | @case-lifecycle-provider-status | n/a: Module activity counts are read-only. | @case-lifecycle-automation-retry | @case-lifecycle-empty | @case-lifecycle-provider-status | @case-lifecycle-provider-status |
| `agent-lifecycle-automation-delivery` | @case-lifecycle-automation-delivery | n/a: A committed transition has no delivery-cancel action. | @case-lifecycle-automation-retry | @case-lifecycle-empty | @case-lifecycle-automation-delivery | @case-lifecycle-automation-delivery |
| `agent-lifecycle-automation-failure-retry` | @case-lifecycle-automation-retry | n/a: Retry submits immediately without a confirmation dialog. | @case-lifecycle-automation-retry | @case-lifecycle-empty | @case-lifecycle-automation-retry | @case-lifecycle-automation-retry |
| `agent-lifecycle-claude-startup-attention` | manual: Requires a real Claude startup trust or attention prompt; the disposable browser provider is Codex-compatible. | manual: Approve or decline the real Claude prompt in its existing terminal. | manual: Exercise real Claude startup recovery after refusing trust. | @case-lifecycle-empty | manual: Click Open terminal on a real Claude attention chip and verify the existing run identity. | manual: Reload with a real Claude startup attention holding. |
| `agent-lifecycle-status-stream` | @case-lifecycle-provider-status @case-lifecycle-status-reconnect | n/a: Project status subscription is automatic, with no cancel control. | @case-lifecycle-status-reconnect | @case-lifecycle-empty | @case-lifecycle-empty @case-lifecycle-status-reconnect | @case-lifecycle-status-reconnect @case-lifecycle-provider-status |

Browser cases use the real approved disposable provider, production hooks,
workflow mutations, status subscription, authoritative GraphQL holdings and
reload. The legacy delivery case retains its title and chip assertions while
removing its fabricated succeeded-attempt snapshots. Legacy files remain intact.
The retry case permits only a fixture exit failure and a refused Retry network
request; it does not inject a successful attempt or holding. Exited status
and nonzero exit code 23 are read through historical Work Item runs; exited providers
contribute no live task or module counts. Recovery verifies the actual pending
retry successor and its lineage, that the lineage settles as a delivered
`started_fresh` success with no unresolved attempt left (the public query keeps
settled successes only as delivery evidence), and a different real working run.
The delivery case repeats its exact Continued/Fresh chip, description and
absent-chip assertions after reload against the canonical snapshot.

CODING-2762 fixed a false stall the provider-status case exposed: a canonical
`working` run rendered an `idle` task badge under Asia/Kolkata browser time.
Launch settlement stores the terminal baseline `last_output_at` as a zone-less
SQLite `datetime`; the browser read it as local time, so the run looked hours
old and projected `stalled`. Holdings and status-event `run` payloads now
publish `last_output_at` as RFC 3339 UTC (`ticketry-runs`
`persistence/queries.rs`), and `status/runPresentation.ts` reads any zone-less
server timestamp as UTC. Regression tests: `studio/src-tauri/tests/run_status_stream.rs`,
**snapshot_and_event_publish_last_output_at_as_explicit_utc** (`cargo test
--manifest-path studio/src-tauri/Cargo.toml --test run_status_stream`), and
`studio/src/features/agents/status/outputActivityHoldings.test.ts`, **reads a
zone-less output timestamp as UTC, as the server does**. Feature run
`2026-10-11T17-36-54-386Z-cce4e2a5` (Asia/Kolkata host) passed all five
lifecycle cases, including `@case-lifecycle-provider-status` and
`@case-lifecycle-automation-retry`, from a dirty working tree. A case citation
describes intended proof, and only the evidence runner can report it verified.

## Relevant code

- `studio/src/features/agents/lifecycle`: work-item/scratch, delivery/failure and Claude attention components.
- `studio/src/features/agents/status`: Apollo holding, selectors, projection, retry writer and durable status consumer.
- `studio/src/features/agents/terminal/LifecycleBadge.tsx` and `studio/src/features/agents/terminal/lifecycle.ts`: labels, glyphs and accessible lifecycle explanations.
- `studio/src/features/agents/actions/agentRunActions.ts`: existing-run focus and terminal attachment; `studio/src/app/navigation/actionIds.ts`: action IDs.
- `studio/src/features/work-items/components/PlanningRowView.tsx`, `studio/src/app/shell/ticket-workspace/ModuleTab.tsx` and `studio/src/features/module-manager/ModuleManagerRow.tsx`: production row/module placement.
- `studio/src/runtime/browserRuntime.ts`: browser GraphQL subscription transport; `studio/src-tauri/crates/worktracking/ticketry-runs/src/persistence/status_stream.rs` and `studio/src-tauri/crates/worktracking/ticketry-runs/src/graphql/automation_attempt/views/retry/mod.rs`: durable stream and retry authority.
- Architecture: [Agent Execution context](../../docs/eventcatalog/domains/agent-execution/index.mdx), [run-status service](../../docs/eventcatalog/domains/agent-execution/systems/agent-execution-system/services/run-status-service/index.mdx) and [one-live-agent ADR](../../studio/docs/adr/0013-one-live-agent-per-work-item-decided-by-the-edge.md). These explain ownership/policy; current source and tests establish reachable behavior.

## Gotchas

- Status-stream reconnection and terminal transport reconnection are different axes. A **Reconnecting** terminal chip does not by itself prove the project status feed is unhealthy, and output silence does not prove a process exited.
- Browser status rendering/replay is supported and tested with controlled frames. It cannot establish native libghostty drawing/input, packaged hook launch, desktop trust prompts or native tmux terminal retention. End-to-end desktop/provider claims need the macOS harness or an isolated manual desktop run with a real/disposable provider.
- Real Claude trust/startup handling needs its executable and a qualifying startup reason. The numbered tests inject those reasons; their successful focus assertions do not prove a real Claude trust decision. Passive attention and automation failures must not steal focus before an explicit click.
- The retry helper's historical comment/error says desktop status transport, but `browserRuntime.ts` currently returns a GraphQL status transport. Browser provider retry remains unverified end to end; do not infer a successful provider launch from transport availability.
- Older status/lifecycle comments mention removed Django/Python ownership. The [context map](../../CONTEXT-MAP.md) also contains old source paths and status-invalidation descriptions. Follow the current source pointers above; those historical references are not additional behavioral proof.
- The Playwright shared onboarding setup still targets the old Modules pane / **+ Add Module** dialog path. Browser cases may stop in setup before their lifecycle assertions; see [Onboarding](onboarding.md). The desktop harness also retains that older module-creation path. These authored scenarios need current reachability evidence before a passing-provider or UI journey can be claimed.
