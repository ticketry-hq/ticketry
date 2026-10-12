# Settings

Settings configures available providers, launch defaults, conversation instructions and shortcuts, with explicit draft commits and a modal-local model change ledger.

Surfaces: browser, desktop
Editions: pocock, core

## Sub-features

- `settings-modal-sections`: Open the singleton Settings dialog and switch Models, Conversations, Keyboard shortcuts and App updates.
- `settings-model-configuration`: Activate providers, register Codex profile names and save the global provider/profile/model/reasoning default.
- `settings-instant-launch-defaults`: Edit or clear the starter prompt used by new conversations through the shared conversation settings panel.
- `settings-change-ledger`: Observe pending model changes and their successful commit in the Applied changes log.

## How to get to it

Use the footer button **Open Settings** or global keymap action `settings` (default E outside editable input). The same opener is available during bootstrap and service-health recovery; see [Startup and service health](startup-and-service-health.md). Native terminal chord routing reaches the same singleton dialog; see [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md).

Inside the **Studio settings** dialog, use the **Settings sections** tablist. **Models** is the normal initial tab; **Conversations**, **Keyboard shortcuts** and **App updates** select their panels. The conversation workspace also consumes the shared **Conversation configuration** panel; its entry is mapped in [Conversations](conversations.md). Close with **Close dialog**, Escape or the backdrop.

Workflow and issue-type configuration is reached from workspace configuration, not a Settings rail tab; see [Workflows and issue types](workflows-and-issue-types.md). Keyboard customization is detailed in [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md); App updates runtime coverage belongs to the desktop/system campaign.

## Prerequisites

Beyond the [index baseline](README.md), Models requires successful provider catalog and configurable-capability reads. Provider credentials are unnecessary to edit configuration; saved configuration alone does not prove runnable credentials. No selected project is needed for the host-level Models or Conversations settings. Workflow catalog consumers require the project described in the workflow entry.

Use a wide viewport to inspect the Applied changes log: the sidebar ledger is hidden at the modal's narrow-layout breakpoint. To verify native occlusion, present a native terminal before opening Settings.

## Expected behavior

- Models loads independently of workflow catalogs. Only activated providers appear in launch selectors. The panel registers profile names; Codex owns the profile configuration. Switching provider clears dependent choices through the shared picker. Deactivating the current default provider is refused with **Repoint the launch default before deactivating …** until the default is changed.
- Editing Models creates outstanding changes. **Save changes** and **Discard** are disabled without changes or while saving. Discard restores the last confirmed catalog. Validation prevents an incompatible configuration from saving. Successful save adopts the authoritative response, shows **Model configuration saved.**, clears the unsaved count and commits pending ledger entries. Failed save retains the draft and unsaved count with an error. Reload reads the saved default.
- The Conversations panel loads the saved starter prompt; missing or malformed fields decode to an empty prompt and false auto-close. The prompt accepts up to 8,000 characters. **Save conversation settings** saves or clears it and adopts the response; **Discard** restores the last save. Load/save errors are visible; a failed save retains the draft for retry. Controls wait for loading/saving. Closing an unsaved panel does not save its draft.
- **Applied changes** starts with **No changes yet.** Models edits appear as pending entries with `--:--`; successful save converts matching entries to applied timestamps. The modal shows the three newest entries, retains model drafts when switching rail tabs, and creates a fresh ledger on remount. Conversation saves do not populate this model ledger. It is not a persisted audit history.
- The modal contains Tab focus and restores prior focus when unmounted. Opening or closing it preserves retained native terminal viewers while the WebView owns modal input. The keyboard and update panels use their own commit/status flows, rather than the Models footer controls.

## Verifying it

Prefer dialog **Studio settings**, tablist **Settings sections**, region **Model configuration**, checkboxes **Activate claude/codex/gemini**, comboboxes **Agent/provider**, **Model**, **Reasoning**, textbox **New Codex profile**, and buttons **Remove Codex profile {name}**, **Save changes** and **Discard**. `settings-scroll-container` identifies the Models scroller. Observe **Settings commit actions**, the unsaved count and log **Applied changes**; inspect pending/applied `data-tone` values. Conversations uses textbox **Conversation starter prompt** and **Save conversation settings**. Wait for the saved/error message, then reopen/reload and read the authoritative persisted settings before claiming persistence.

| Existing coverage | What it establishes | Narrow command |
| --- | --- | --- |
| `studio/src/test/overhaulProviderCatalogColdStoreAcceptance.test.tsx` | Workflow editor store initialization leaves the provider catalog unread; overhaul-840 cold-opens Settings from the footer after that initialization, reports a failed catalog read, and reopens onto the saved default without an update. | `bun run --cwd studio test src/test/overhaulProviderCatalogColdStoreAcceptance.test.tsx` |
| `studio/src/test/overhaulSettingsAcceptance.test.tsx` | overhaul-22 cold Models opening without workflow catalog reads; overhaul-122 shortcut persistence; overhaul-368 accessible binding names; additional cases cover model validation, discard/save failure, ledger, close/Escape and focus. | `bun run --cwd studio test src/test/overhaulSettingsAcceptance.test.tsx` |
| `studio/src/test/overhaulInstantSettingsAcceptance.test.tsx` | overhaul-203 edits/clears the prompt; overhaul-313 preserves failed drafts, retries, discards and reports failed reads using a substituted GraphQL runtime. | `bun run --cwd studio test src/test/overhaulInstantSettingsAcceptance.test.tsx` |
| `studio/src/test/overhaulCodexProfilesAcceptance.test.tsx` | overhaul-297 registers/deduplicates/selects/saves/removes profiles and disables model/reasoning for a selected profile; CODING-1826 covers ledger additions/removals. | `bun run --cwd studio test src/test/overhaulCodexProfilesAcceptance.test.tsx` |
| `studio/src/test/overhaulWebSettingsReachabilityAcceptance.test.tsx` | overhaul-217/218/219 opens Settings during bootstrap connecting, failed health and pending health. | `bun run --cwd studio test src/test/overhaulWebSettingsReachabilityAcceptance.test.tsx` |
| `studio/src/test/overhaulSettingsNativeOcclusionAcceptance.test.tsx` | overhaul-117 footer open/close over a native viewer, plus singleton native-chord entry, with a substituted native runtime. | `bun run --cwd studio test src/test/overhaulSettingsNativeOcclusionAcceptance.test.tsx` |

Browser proof lives in the [End-to-end suite](#end-to-end-suite): `bun run --cwd studio test:e2e:feature settings`. It drives the footer and E entry points, every rail section, close by button/Escape/backdrop with Tab containment and focus restoration, the guarded default-provider deactivation, Codex profile registration, a failed and retried Models save with its ledger entries, the narrow-layout ledger hiding and remount, and the Conversations prompt from both the rail and the **Configure Conversations** section header, including read/save failures, the 8,000-character cap, close-without-save and reload. The Models database case reads `state.db` in the runner-owned profile through `studio/scripts/read-persisted-model-settings.mjs` (`node --test studio/scripts/read-persisted-model-settings.test.mjs`). The legacy `studio/e2e/model-settings-database.spec.ts` and the Settings case in `studio/e2e/web-app.spec.ts` stay in place until CODING-2720 retires them.

Not proven in the browser: native-chord entry and native terminal occlusion (desktop only), real restart persistence of the installed app, and the Models validation refusal, which the current pickers cannot reach because Model and Reasoning only offer catalog values for the chosen provider. Vitest substitutes above remain the evidence for those paths.

## End-to-end suite

Suite: studio/e2e/features/settings.spec.ts

Each case runs in its own disposable profile (`isolation: "case"`) because Models and Conversations write host-wide settings. Failure cases abort the named GraphQL operation at the network boundary; every saved configuration reads Rust state back. The catalog-read case holds the real project-open request, which also contains the provider catalog, and opens Settings from the connecting gate before aborting its catalog read; it then releases the real request and reopens Settings after restoring the network. The startup-entry case opens and cancels Settings from both connecting and unavailable gates before restoring the real workspace.

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `settings-modal-sections` | @case-settings-sections-entry-and-close @case-settings-every-section @case-settings-startup-entry | @case-settings-sections-entry-and-close @case-settings-startup-entry | @case-settings-startup-entry | n/a: The rail always lists the same four sections. | @case-settings-sections-entry-and-close @case-settings-startup-entry | n/a: The selected section is transient UI state with nothing to store; Settings reopens on Models. |
| `settings-model-configuration` | @case-settings-models-database @case-settings-every-section @case-settings-codex-profiles | @case-settings-every-section @case-settings-default-provider-guard | @case-settings-default-provider-guard @case-settings-change-ledger @case-settings-models-load-recovery | @case-settings-codex-profiles | @case-settings-models-database @case-settings-sections-entry-and-close | @case-settings-models-database @case-settings-codex-profiles @case-settings-change-ledger |
| `settings-instant-launch-defaults` | @case-settings-conversation-prompt @case-settings-conversation-header-entry | @case-settings-conversation-prompt | @case-settings-conversation-failures | @case-settings-conversation-prompt | @case-settings-conversation-prompt @case-settings-conversation-header-entry | @case-settings-conversation-prompt @case-settings-conversation-failures |
| `settings-change-ledger` | @case-settings-change-ledger | @case-settings-change-ledger | @case-settings-change-ledger | @case-settings-change-ledger @case-settings-conversation-header-entry | @case-settings-change-ledger | @case-settings-change-ledger |

## Relevant code

- `studio/src/features/settings`: host setting operations and generated documents, conversation panels, model/workflow ledger helpers, and Apollo-backed adapters for project type/state/capability consumers; the latter behaviors are mapped in [Workflows and issue types](workflows-and-issue-types.md).
- `studio/src/features/studio`: Settings modal/frame, keyboard modal adapters, project/module and status/parent modals, launch-chain adapters and shared Studio helpers. This is a consumed adapter area, not another product workspace: AddProject/default-project behavior is mapped in [Projects](projects.md); AddModule/folder validation in [Module folders and trust](module-folders-and-trust.md) and [Module Manager](module-manager.md); StatusUpdate/ParentUpdate in [Ticket details](ticket-details.md); PlanFeature's prompt/folder/provider chain in [Agent launch](agent-launch.md) and [Conversations](conversations.md); keyboard panels/live-terminal cycling in [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md). Its remaining type/path helpers support these consumers.
- `studio/src/features/workflows/ModelConfigurationPanel.tsx` and `studio/src/features/workflows/LaunchDefaultPicker.tsx`: provider/profile drafts, default selection, validation and authoritative commit callbacks.
- `studio/src/app/shell/StudioFooterActions.tsx`, `studio/src/app/modal/modalStore.ts` and `studio/src/app/modal/ModalHost.tsx`: production opener and singleton modal hosting.
- `studio/src/app/navigation/keymapBindings.ts` and `studio/src/app/navigation/nativeTerminalChords.ts`: default Settings binding and native entry routing.
- `studio/src/app/shell/ticket-workspace/selected-ticket/SelectedTicket.tsx`: workspace consumption of conversation configuration.
- `studio/scripts/read-persisted-model-settings.mjs`: isolated database evidence used by the browser Models test.

## Gotchas

- Apollo alone owns the provider catalog. The workflow editor store's `providerCapabilities` is a read-only view of that catalog and never writes provider rows back (CODING-2913): its initial empty value once seeded a synthetic empty catalog that cold Settings adopted instead of reading Rust. `@case-settings-models-load-recovery` and overhaul-840 guard that a cold Models open reads the real catalog, reports a failed read and recovers on reopen without saving.
- The visible rail says **Conversations**; `instant` and `instant_launch` remain implementation/storage names. Auto-close remains a stored field and is passed back unchanged by prompt edits, but there is no visible auto-close control. Do not invent that UI from the stored shape.
- Catalog saves and model default readback use the existing generated GraphQL operations; there is no product REST API. Follow [CLAUDE.md](../../CLAUDE.md) and the [Work Management context](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/CONTEXT.md). Link the [route/operation registry](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/graphql/operation_registry.rs) rather than cloning its exceptions. When verification also moves a WorkItem, use its identity-scoped update with an exclusive state patch; agent-origin transitions obey workflow permissions, including human-only edges, as detailed in [MCP server and tools](mcp-server-and-tools.md).
- Models stays mounted while its tab is hidden; its draft survives rail navigation. Conversations is conditionally mounted, so switching away loses its unsaved draft. Closing is not a save operation or a confirmation flow.
- The Applied label also contains pending entries. Ledger timestamps and displayed entries are modal-local feedback, not database evidence; inspect the saved catalog or database independently.
- The legacy browser Settings case's historical title overstates its rail coverage; the feature suite's sections case visits every section. Native focus and installed-app restart persistence remain unverified in the browser.
- `studio/src/features/studio` is a code-location pointer under Relevant code, not a sub-feature: its consumed modals are proven by the suites of the entries that own them.
- Model is a catalog select, not free text. Tests choose catalog values with `selectOption`; a stored `global_default` now carries `profile`, which the database oracle script mirrors from the Rust reader.
