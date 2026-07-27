# LLD — Tabbed Ticket Drawer

## 1. Scope

CODIN-703 turns the Studio issue drawer into the issue-scoped workspace shell for ticket details, design docs, terminal sessions, and doc-chat entry points.

This LLD is the implementation harness for the parent slice and its children. It does not implement code. It defines the seams, dependency order, tests, and acceptance checks needed before implementation starts.

The drawer receives only the ticket identifier as external input. It must resolve the ticket workspace from that identifier and must not accept project, module, worktree, or profile scope as drawer props.

## 2. Current Code Facts

- Drawer route sync lives in `studio/src/app/routes.tsx`. A `/issues/:key` route opens the drawer without changing the background `activeView`, so `/coding` can stay mounted behind the drawer.
- The current drawer host is `studio/src/shell/IssueDrawerHost.tsx`. It already owns route-driven open/close behavior and the right-side overlay.
- Studio ticket details are rendered by `studio/src/issue/IssueDetail.tsx`. This remains the Details tab content.
- Coding workspace behavior exists in `studio/src/coding/panes/TicketWorkspace.tsx`, `workspaceStore`, `terminalStore`, `TerminalHost`, `DocTab`, and `AgentPicker`.
- Current coding keyboard Enter does not refetch the issue description before opening the agent picker. It opens the picker from selected row state.
- Spawn-time prompt construction does refetch task details through backend prompt building before constructing the agent prompt. That fresh backend fetch is the context guarantee for launched agents.
- Existing terminal foreground arbitration belongs in `studio/src/stores/terminalForegroundStore.ts`. It models drawer ownership over a session key with coding as fallback.
- Existing drawer workspace orchestration work belongs behind `studio/src/stores/issue/drawerWorkspaceStore.ts` and `issueWorkspaceContext.ts`.

## 3. Decisions

### Drawer Contract

The drawer presentation accepts only an issue key or issue id. Everything else is resolved through an issue-workspace layer.

The drawer must not visibly repoint `/coding` selection to discover docs, restore terminals, or launch an issue-scoped run.

### Details Tab

The Details tab is pinned, non-closable, and renders the existing Studio `IssueDetail` unchanged.

First open defaults to Details unless prior per-ticket workspace state clearly points at an available Doc or Terminal tab.

### Workspace Orchestration

Create or continue a single drawer-side issue workspace seam that:

- fetches fresh issue detail from the ticket id;
- resolves project id and best-effort module context;
- initializes the coding profile/API-key context needed by existing coding APIs;
- discovers docs with the existing documents API;
- discovers terminal sessions with the existing terminals API;
- hydrates shared workspace and terminal stores without changing visible `/coding` selection;
- exposes launch readiness and degraded states to the drawer.

If module context cannot be resolved, doc and terminal discovery should still show explicit degraded state rather than silently failing. Issue-scoped launch actions stay disabled until the launch boundary can resolve scope.

### Terminal Ownership

A live terminal session has exactly one foreground xterm DOM owner at a time.

The drawer has priority while it foregrounds a session. `/coding` remains mounted if it was already the active background view, but its matching terminal presentation must back off instead of duplicating the xterm instance.

Terminal object lifecycle and scrollback must survive ownership transfers.

### Docs

Doc discovery runs on drawer open. Discovered docs become closable Doc tabs keyed by document identity, with closed docs available as dormant reopen chips.

Doc tabs render sandboxed HTML through the existing document URL path. Details remains the quiet first-open fallback when no prior active doc state exists.

### Launch Path

Starting a terminal/agent run or doc-chat from the drawer must cross an issue-scoped launch boundary. The drawer UI must not assemble module folder, worktree root, profile, or prompt context itself.

The backend prompt builder remains responsible for fresh task-detail context at spawn time. If a future frontend helper is added, it may resolve display state, but it must not become the source of truth for agent prompt context.

### `/coding` Compatibility

The `/coding` route remains functional. Existing coding task selection, tab behavior, keyboard shortcuts, and agent picker behavior must not regress.

## 4. Implementation Steps

### Step 1 — Drawer Shell and Resize

Update `IssueDrawerHost` to host a tab strip and panel-style resize while preserving current route-driven open/close behavior.

Keep left nav visible. Persist drawer width as a viewport ratio using the existing UI-store pattern. Details is the only required content for this step.

Acceptance: opening `/issues/:key` shows pinned Details, renders `IssueDetail`, and resize persists across remount.

### Step 2 — Issue Workspace Orchestration

Introduce or finish the issue-workspace store and resolver behind the drawer.

The resolver fetches the current issue detail by key/id, derives project id, attempts module ancestry resolution, loads config/profile state, discovers documents and terminal sessions, and hydrates shared stores by resolved task id.

It must not call coding task selection as a side effect and must not mutate `/coding` visible project/module/task selection.

Acceptance: drawer-first open loads docs/session metadata by issue id, initializes profile readiness, and leaves existing `/coding` selection unchanged.

### Step 3 — Terminal Foreground Ownership

Use the terminal foreground store as the single owner registry for live xterm presentation.

Make the coding terminal host honor drawer claims by detaching presentation without closing or recreating the terminal. Add the drawer terminal host/presentation so it claims the same foreground key while active and releases it on tab close or drawer close.

Acceptance: one live session can move coding to drawer to coding without duplicate terminal construction, duplicate WebSocket attach, or lost scrollback.

### Step 4 — Doc Tabs

Render discovered drawer docs as closable tabs using the shared workspace model. Closing a doc moves it to dormant chips; reopening restores it without rediscovery.

Keep iframe rendering read-only in this step. Doc-chat overlay stays out of this step.

Acceptance: docs discovered from issue id render inside the drawer, tab switching changes the visible iframe, closing moves docs to dormant chips, and Details remains pinned.

### Step 5 — Terminal Tabs

Render active/restored terminal sessions as drawer Terminal tabs with lifecycle/attention badges and terminated-run history chips.

Starting a new run from the drawer must call the issue-scoped launch boundary. The drawer provides only issue id, selected agent, and optional user prompt/doc metadata.

Acceptance: live/restorable runs appear by issue id, terminated runs are inert history chips, lifecycle badges match existing semantics, and new drawer-launched runs are scoped by the issue boundary.

### Step 6 — Doc-Chat Overlay

Add drawer doc "edit with agent" behavior using existing per-document doc-chat semantics.

The overlay is keyed by issue id plus document relative path/document id. It uses the issue-scoped launch boundary and does not create a normal terminal tab unless existing doc-chat semantics require it.

Acceptance: opening edit-with-agent on a drawer doc reveals the doc-chat overlay for that document, restores the same doc-chat session when present, and does not affect unrelated doc tabs.

## 5. Test Harness

### Primary Rendered Integration Test

Extend drawer-level testing around `IssueDrawerHost`.

Seed issue/detail data, document discovery, terminal discovery, workspace state, and foreground ownership. Assert the user-visible behavior:

- pinned Details tab renders Studio `IssueDetail`;
- Doc tabs and dormant doc chips are derived from the issue id;
- Terminal tabs and history chips are derived from the issue id;
- tab switching changes visible content;
- drawer terminal ownership removes the matching coding terminal presentation;
- closing the drawer releases drawer terminal ownership.

### Orchestration Store Test

Test the issue-workspace seam directly.

Assert it fetches fresh issue context, resolves project/module context where possible, loads profile readiness, fetches docs and terminal sessions by resolved task id, hydrates shared stores, and does not change coding selected project/module/task.

Also assert degraded module resolution leaves read paths visible and launch actions not ready.

### Regression Tests

Keep existing `/coding` tests green:

- coding route mounts through `BootstrapGate`;
- `TicketWorkspace` doc behavior remains intact;
- `TerminalHost` still works with no drawer claim;
- coding keyboard Enter still opens the existing agent flow;
- spawn-time prompt building still fetches fresh task details before building agent context.

## 6. Out of Scope

- Replacing Studio `IssueDetail` with coding `DetailsTab`.
- Passing project/module/worktree/profile scope into the drawer component.
- Retiring or restructuring `/coding`.
- Full transport/API unification.
- Building a second coding app inside the drawer.
- Implementing backend spawn-run work beyond consuming the issue-scoped launch boundary exposed by related spawn-run tickets.

## 7. Acceptance Checklist

- The drawer opens from only an issue identifier.
- Details is pinned, non-closable, and uses existing Studio `IssueDetail`.
- Drawer-first use works without visiting `/coding`.
- Docs and terminals resolve by issue id.
- Prior per-ticket active tab state is restored where valid.
- Live terminal foreground ownership is single-location with drawer priority.
- Terminal scrollback survives surface transfer.
- New run/doc-chat launch is issue-scoped and does not require drawer-owned scope assembly.
- `/coding` remains usable and non-regressed.
- Tests cover drawer integration, orchestration, terminal ownership, and launch-context freshness.

