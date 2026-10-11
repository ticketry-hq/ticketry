# Multi-surface journeys

Walk connected product paths across creation, workflow execution, sprint navigation, description isolation and durable terminals while keeping browser, desktop and mocked evidence distinct.

Surfaces: browser, desktop, manual

## Sub-features

- `journey-create-run-restart`: [Projects](projects.md), [Onboarding](onboarding.md), [Module Manager](module-manager.md), [Stories list](stories-list.md), [Agent launch](agent-launch.md), [Agent lifecycle and status](agent-lifecycle-and-status.md), [MCP server and tools](mcp-server-and-tools.md) and [Ticket terminals](ticket-terminals.md) compose creation through workflow completion, reload and desktop restart.
- `journey-sprint-close-restore`: [Stories list](stories-list.md), [Module tabs](module-tabs.md) and [Module Manager](module-manager.md) compose sprint-filtered tab hiding and explicit restoration.
- `journey-description-story-isolation`: [Stories list](stories-list.md), [Ticket details](ticket-details.md), [Ticket workspace tabs](ticket-workspace-tabs.md) and [Descriptions and documents](descriptions-and-documents.md) keep two Stories' edits and saved descriptions separate.
- `journey-terminal-manager-reload`: [Agent launch](agent-launch.md), [Ticket workspace tabs](ticket-workspace-tabs.md), [Ticket terminals](ticket-terminals.md), [Module Manager](module-manager.md) and [Module terminal panel](module-terminal-panel.md) distinguish viewer takeover from session loss and restore authoritative terminal identity after reload.

## How to get to it

**`journey-create-run-restart`**

1. Start a fresh isolated installation via [Startup and service health](startup-and-service-health.md). [Projects](projects.md) resolves the default Coding/CDN project, creating it when neither CDN nor legacy CODING exists. There is no reachable **Add project** control or project switcher: record this UI gap; separate `create_project` request coverage cannot stand in for a user action.
2. Complete [Onboarding](onboarding.md), create the first module with its folder and confirm provider trust. For an onboarded installation, use [Module Manager](module-manager.md)'s **New module** form and [Module folders and trust](module-folders-and-trust.md); the top picker **Create new module** opens this flow too.
3. In [Stories list](stories-list.md), enter a unique name in **Capture an idea** and press Enter. Select that Story, inspect its [Ticket details](ticket-details.md), and use [Agent launch](agent-launch.md)'s **Run item**.
4. Follow [Agent lifecycle and status](agent-lifecycle-and-status.md)'s task/module indicators and the Story's workflow state. The disposable desktop provider moves Ideas through Implement, Review and Done using [MCP server and tools](mcp-server-and-tools.md) and [Hook runner and lifecycle reporting](hook-runner-and-lifecycle-reporting.md); use the fixture's gates rather than assuming a paid provider will follow that exact sequence.
5. Open the run's [Ticket workspace tabs](ticket-workspace-tabs.md) terminal. After completion, reload the WebView, reopen the same Story and check Done and resumable terminal history via [Ticket terminals](ticket-terminals.md). Stop and restart desktop over the same disposable data directory and repeat those observations.

**`journey-sprint-close-restore`**

1. In a Roadmap-enabled build, use [Stories list](stories-list.md)'s **Sprint: <selection>** chooser to select a sprint with root Stories in at least two linked modules. Observe the shared [Module tabs](module-tabs.md) projection.
2. Use **Hide <name> tab**, or [Module Manager](module-manager.md)'s **Close <name> tab**, on the selected matching module. Confirm the filter stays active and a linked visible fallback becomes selected; reload and confirm the closed presentation remains hidden.
3. Use [Module tabs](module-tabs.md)'s **Open module picker** and **Restore <name> module tab** to restore/select it, or [Module Manager](module-manager.md)'s **Restore <name>** to restore without selecting. A matching module keeps the sprint filter; a module excluded from that sprint explicitly clears it before restoration.
4. Repeat with the last matching tab hidden: [Module tabs](module-tabs.md)'s **All matching module tabs are hidden.** is recovery, not deletion. Restore the matching module explicitly, then inspect persisted visibility and unchanged module/rank records.

**`journey-description-story-isolation`**

1. Create two Stories A and B using [Stories list](stories-list.md). Select A and its **Details** tab through [Ticket details](ticket-details.md) and [Ticket workspace tabs](ticket-workspace-tabs.md).
2. Type unique text in A's rich editor, scoped to its visible `issue-description`, then leave focus to autosave as described by [Descriptions and documents](descriptions-and-documents.md). Wait for the write result; open B and ensure A's text is absent.
3. Give B different text, autosave, and return to A. Use [Descriptions and documents](descriptions-and-documents.md)'s ticket-keyed persistence rules to read back both identities and descriptions; each must contain its own text and exclude the other's.
4. Reload and reselect A, then B through [Stories list](stories-list.md); repeat the saved-description checks. Pending-write and rejected-write variants remain scoped to the original Story, with retry/error handling from [Descriptions and documents](descriptions-and-documents.md).

**`journey-terminal-manager-reload`**

1. Launch a disposable run via [Agent launch](agent-launch.md) and select its terminal in [Ticket workspace tabs](ticket-workspace-tabs.md). Record the run and session identities from [Ticket terminals](ticket-terminals.md); use a fixture that stays live long enough to exercise navigation.
2. Open [Module Manager](module-manager.md) with the footer **Open Module Manager** or `toggle-module-manager` (Cmd+Shift+M). The native viewer hides and surrenders focus; dismiss with Escape and confirm the same viewer/session returns, without a second launch or termination.
3. Reload and reopen the same Story/terminal via [Ticket workspace tabs](ticket-workspace-tabs.md). [Ticket terminals](ticket-terminals.md) rebuilds from authoritative records; verify the same durable run/tmux identity and liveness rather than expecting the native view object to survive WebView destruction.
4. For the closest real browser transport path, open [Module terminal panel](module-terminal-panel.md) through **Open terminal panel** or `toggle-terminal-panel` (Ctrl+backtick), print a unique marker, minimize/restore, reload and confirm the same shell identity/output. This shell round-trip covers transport durability separately; it does not cover Module Manager takeover or native agent rendering.

## Prerequisites

- Use the isolated data, provider onboarding, selectors and proof rules in [the index](README.md). This map campaign adds no live walkthroughs or new runnable journeys; those belong to CODING-2685.
- Creation/run/restart needs macOS, Rust/Tauri prerequisites, tmux, a writable disposable module folder and the desktop harness's disposable Codex-compatible provider. Workflow edges and agent-allowed transitions must permit the requested moves; human-only gates remain enforced. Browser compatibility checks are not paid-provider or native execution evidence.
- Sprint close/restore needs a Roadmap-enabled build, authoritative sprint/root membership, linked modules and hidden/restorable presentations. With Roadmap off, report this variant unavailable and use ordinary hide/restore coverage instead.
- Description isolation needs two concrete Story identities. Terminal takeover/reload needs authoritative run/session records; keep live-session continuity separate from completed resumable history.

## Expected behavior

- Creation selects/provisions the installation default; module creation validates folder/trust and preserves one retry-safe identity. Blank Story capture does not create a record; rejected creation preserves its draft. Cancel or trust refusal leaves the relevant creation flow recoverable without silently launching a run. The first-run desktop scenario covers the real module/Story path; explicit add-project UI remains absent.
- A successful fixture launch produces active task/module indicators and terminal presentation, then observable Implement, Review and Done states. Completion clears aggregate activity and exposes resumable run history after reload and process restart. Failure/refusal and workflow gating follow the linked area entries; this successful journey is not exhaustive error/cancel coverage.
- Closing a module changes `tab_hidden`, not its archive flag, Stories or canonical rank, and preserves the sprint filter. Restore is explicit: picker Restore selects after visibility succeeds; Manager Restore keeps inspection open without selecting. Matching and excluded-module restoration have different filter outcomes. Failed/stale writes must not override newer project/filter navigation; empty matching results distinguish hidden tabs from no sprint membership.
- Description drafts and writes bind to the selected ticket ID. Opening B must not display A's draft or send A's description under B's identity. A rejected write keeps the original Story's draft with an inline error for retry; there is no description Cancel action. Successful writes remain separate after authoritative reads and reload.
- Manager takeover hides native terminal presentation and suppresses focus without detaching the retained viewer in the mocked acceptance seam. Reload discards viewer objects and reconstructs presentation from durable records. Explicit terminal/shell Close can terminate a run, so it is not a continuity check; an ended/resumable record is not a live tmux session.

## Verifying it

No behavior walkthrough or desktop/browser execution is claimed by this entry. These are existing coverage pointers and remaining verification targets:

| Journey | Existing evidence and limits | Narrow command |
| --- | --- | --- |
| `journey-create-run-restart` | `studio/scripts/desktop-agent-acceptance.mjs` and `studio/e2e-desktop/README.md` author a fresh-profile scenario: onboarding, module/folder trust and Story creation, Run item, real Rust/MCP/hooks/private tmux fixture, active task/module badges, Implement/Review/Done, completion, WebView reload and debug Tauri application stop/relaunch over the same data. This is an application restart, not only a service refresh or installed-release proof. Observe `agent-state-badge` with `data-state`, the module's **Agent is actively working**, native renderer host and resumable terminal history. Default provisioning is source-grounded; the scenario does not click Add project or assert the entire catalogue. Its retired **+ Add Module** setup can block these assertions; see Gotchas. | `bun run --cwd studio test:e2e:desktop` |
| Project-creation portion | `studio/e2e/project-lifecycle.spec.ts`: **provisions the reviewed catalogue when a project is created** checks the public GraphQL create contract and independent catalogue. This is request-level evidence, not an add-project UI journey. | `bun run --cwd studio test:e2e -- e2e/project-lifecycle.spec.ts --grep 'provisions the reviewed catalogue'` |
| `journey-sprint-close-restore` | `studio/src/test/overhaulSprintModuleCloseAcceptance.test.tsx`: `overhaul-600`–`overhaul-602` cover filtered close, unchanged records/rank/filter, simulated reload, refusal and navigation races. `studio/src/test/overhaulExplicitModuleNavigationAcceptance.test.tsx`: `overhaul-604`–`overhaul-610` cover excluded restore/filter clearing, unavailable Open, pending restore generations and last-hidden-match recovery. Some navigation variants use test-only action buttons; these mocked GraphQL/real-shell checks are not a live browser or desktop combined journey. Read `tab_hidden`, module archive/rank and selected-sprint intent as well as module tabs' `data-module-id`/`aria-selected`. | `bun run --cwd studio test -- src/test/overhaulSprintModuleCloseAcceptance.test.tsx src/test/overhaulExplicitModuleNavigationAcceptance.test.tsx` |
| `journey-description-story-isolation` | `studio/scripts/desktop-description-acceptance.mjs`, called by the desktop agent harness, types through the real WKWebView rich contenteditable, autosaves two distinct descriptions, switches Stories and reloads, requiring each displayed description to exclude the other's. It checks UI after reload, without a separate GraphQL response assertion; direct two-ticket readback remains an additional verification target. | `bun run --cwd studio test:e2e:desktop` |
| Description pending/refusal variants | `studio/src/test/overhaulDescriptionSelectionAcceptance.test.tsx`: `overhaul-248`; `studio/src/test/overhaulDescriptionAutosaveAcceptance.test.tsx`: CODING-1525 a/c and CODING-1549 c cover selected-ID binding, switch-save, rejection/retry and pending writes on the original Story. Rich-editor/runtime boundaries are mocked; these do not establish native typing. | `bun run --cwd studio test -- src/test/overhaulDescriptionSelectionAcceptance.test.tsx src/test/overhaulDescriptionAutosaveAcceptance.test.tsx` |
| `journey-terminal-manager-reload` | `studio/src/test/overhaulModuleManagerNativeAcceptance.test.tsx`: `overhaul-613` checks native hide/show, focus suppression, one attachment, no detach and unchanged session through Manager takeover. `studio/src/test/overhaulTerminalRestorationAcceptance.test.tsx`: `overhaul-35`, `overhaul-49`, `overhaul-111`, `overhaul-112` rebuild terminal/launch identity from mocked authoritative records after restoration. These are separate mocked seams; no existing real scenario was identified that combines Manager takeover, reload and live native terminal continuity. | `bun run --cwd studio test -- src/test/overhaulModuleManagerNativeAcceptance.test.tsx src/test/overhaulTerminalRestorationAcceptance.test.tsx` |
| Closest browser terminal round-trip | `studio/e2e/web-app.spec.ts`: **opens, hides, restores, and closes a Rust-backed module shell** prints `TICKETRY_PTY_OK` and verifies retained output after reload, plus panel hide/restore and module switching. Observe `terminal-panel-tab`'s `data-run-id` and browser `terminal-host`; read authoritative run/session identity for continuity evidence. This case never opens Module Manager, and its shared module-entry setup is stale. | `bun run --cwd studio test:e2e -- e2e/web-app.spec.ts --grep 'opens, hides, restores, and closes a Rust-backed module shell'` |

The browser suite in **End-to-end suite** now covers creation cancel and failure paths, sprint-filtered hide/restore against the real backend, and terminal takeover plus reload over xterm. Native libghostty takeover plus reload, and the desktop process restart, are still not covered end to end. Area entries list their narrower coverage. The desktop harness has no supported standalone description filter; its MCP-recovery mode skips the description and normal completion/restart portion, so that mode cannot verify the full journeys here.

## End-to-end suite

Suite: studio/e2e/features/multi-surface-journeys.spec.ts

Run `bun run --cwd studio test:e2e:feature multi-surface-journeys`. Every case runs in its own disposable profile (`isolation: "case"`), and each launch uses the disposable Codex-compatible fixture provider from [Agent launch](agent-launch.md). Each successful path writes through the real Rust GraphQL adapter, MCP and tmux. Refusals are injected only at the GraphQL network boundary: `SetModuleLink`, `CreateWorkTrackerWorkItem`, `UpdateWorkTrackerModulePresentation` and `UpdateWorkTrackerWorkItemDetails`. The session-loss case uses the fixture's real nonzero exit (23), not a mocked state.

- `journey-create-run-restart`: browser cases prove creation, launch, Implement → Review → Done through MCP, completion and a WebView reload. The process restart remains desktop-only. There is still no reachable **Add project** control, so the journey starts from the provisioned default project.
- `journey-sprint-close-restore`: proven against real sprint membership and `tab_hidden` read-back, without the Vitest navigation seams.
- `journey-description-story-isolation`: the isolation case opens Story A before capturing Story B, because capturing back to back can silently drop the second Story (CODING-2868, a product defect).
- `journey-terminal-manager-reload`: browser cases render with xterm over `browserTerminalClient`. They prove the viewer is kept through Module Manager takeover, and the durable run and session identity after reload. Native libghostty hide/show remains supplementary desktop evidence (`nativeTerminal: false` in the browser runtime).

No group ticket (CODING-2711 to CODING-2718) identified an existing browser case as cross-area, so no legacy case moved into this suite. The module shell round-trip in `studio/e2e/web-app.spec.ts` (**opens, hides, restores, and closes a Rust-backed module shell**) belongs to [Module terminal panel](module-terminal-panel.md) under CODING-2716.

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `journey-create-run-restart` | @case-journey-create-run-reload | @case-journey-create-recovery | @case-journey-create-recovery | @case-journey-create-recovery | @case-journey-create-run-reload @case-journey-create-recovery | desktop-only: restarting the Rust process over the same data directory needs the desktop harness, because the browser runner's stack cannot be restarted inside a run; the reload round-trip is proven by case journey-create-run-reload |
| `journey-sprint-close-restore` | @case-journey-sprint-close-restore | @case-journey-sprint-recovery | @case-journey-sprint-recovery | @case-journey-sprint-close-restore @case-journey-sprint-recovery | @case-journey-sprint-close-restore | @case-journey-sprint-close-restore @case-journey-sprint-recovery |
| `journey-description-story-isolation` | @case-journey-description-isolation | n/a: descriptions have no Cancel action; drafts autosave when focus leaves | @case-journey-description-write-isolation | @case-journey-description-write-isolation | @case-journey-description-isolation | @case-journey-description-isolation @case-journey-description-write-isolation |
| `journey-terminal-manager-reload` | @case-journey-terminal-manager-reload | @case-journey-terminal-manager-reload | @case-journey-terminal-session-loss | @case-journey-terminal-session-loss | @case-journey-terminal-manager-reload | @case-journey-terminal-manager-reload @case-journey-terminal-session-loss |

## Relevant code

- `studio/e2e/features/multi-surface-journeys.spec.ts` and `studio/e2e/multi-surface-journeys-support.ts`: browser journey suite, disposable linked-folder fixtures and step-gated provider controls.
- `studio/src/app/startup/bootstrapStudio.ts` and `studio/src/features/studio/lib/defaultProject.ts`: installation project resolution before onboarding/navigation.
- `studio/src/features/module-manager/InlineModuleCreation.tsx`, `studio/src/features/module-manager/state.ts` and `studio/src/app/shell/ticket-workspace/tasks/components/IdeaEntry.tsx`: reachable module/Story creation and Manager takeover state.
- `studio/src/features/module-tabs/useCloseModuleTab.ts`, `studio/src/features/module-tabs/useModuleNavigation.ts` and `studio/src/features/work-items/filter/StorySprintFilter.tsx`: close/restore identity and shared sprint navigation.
- `studio/src/features/documents/DescriptionEditor.tsx`, `studio/src/features/documents/descriptionDrafts.ts` and `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx`: Story-keyed editing/autosave and concrete update identity.
- `studio/src/features/agents/terminal/NativeGhosttyTerminal.tsx`, `studio/src/features/agents/terminal/RetainedTerminalViewers.tsx` and `studio/src/app/shell/ticket-workspace/TicketWorkspace.tsx`: takeover visibility, retained viewers and workspace composition.
- `studio/src/features/terminal-panel/moduleShellStore.ts` and `studio/src/features/terminal-panel/panelStore.ts`: authoritative shell rediscovery and local presentation memory.
- `studio/scripts/desktop-agent-acceptance.mjs` and `studio/scripts/desktop-description-acceptance.mjs`: existing cross-surface fixture orchestration and WebKit description proof.

## Gotchas

- There is no current user path to explicitly create/switch an arbitrary project. Fresh default provisioning is the closest reachable production path; the retained service contract is separate. Do not invent a project chooser to complete a checklist.
- Saved drafts, terminal DOM hosts, vanished activity badges and successful MCP responses are different evidence. Verify authoritative identities/state and reload/restart outcomes; a completed terminal's history does not establish a live session survived.
- Native terminal output stays outside the WebView. Host attributes establish presentation routing, not rendered terminal pixels or paid-provider behavior. Browser shell output and mocked native retention cannot establish the combined native continuity journey.
- Historical `studio/e2e/web-app.spec.ts`/`studio/e2e/support.ts` module helpers still expect removed Modules-pane selectors; shared `studio/e2e/onboarding.setup.ts` also has stale module-entry assumptions. Report a setup blocker separately from a journey assertion. See [Module Manager](module-manager.md) and [Onboarding](onboarding.md) for current entry points.
- The desktop agent harness still clicks retired **+ Add Module** in `createStoryThroughStudio`; the current shell's normal entry is Manager/picker creation. Its description, launch and restart assertions are authored coverage pointers, not confirmed runnable evidence for the current shell. Repairing runnable setup belongs to CODING-2685.
- The [keyboard-navigation reference](../../studio/KEYBOARD_NAVIGATION_CURRENT.md) still describes the removed Modules sidebar; follow [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md). The [e2e skill](../../.claude/skills/e2e/SKILL.md) still mentions Django, while the index's canonical browser stack uses the Rust GraphQL adapter.
- The browser cases in **End-to-end suite** are the runnable proof of these journeys. The desktop restart and native-renderer continuity listed above remain desktop-only, and the browser evidence does not claim them.
