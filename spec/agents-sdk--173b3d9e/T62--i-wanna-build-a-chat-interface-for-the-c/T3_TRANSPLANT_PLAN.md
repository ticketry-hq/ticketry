# T3 Code Transplant Plan

Status: Implemented and verified
Ticketry story: WorkTracker #62
Upstream: `pingdotgg/t3code` at `45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b`
Upstream snapshot date: 2026-08-07
License: MIT, Copyright (c) 2026 T3 Tools Inc.

## Goal

Add **Chat** as a first-class Ticketry agent-run type beside the existing
**Terminal** type. A Chat run launches Codex through `codex app-server`, renders
the run as a structured conversation, and remains attached to the same Ticketry
work item, worktree, prompt, MCP configuration, and lifecycle history as a
Terminal run.

The implementation should reuse T3 Code source wherever the code can be adapted
without importing an entire second application architecture. This supersedes
T62's earlier "patterns only" and "no attribution obligation" decisions.

## Implemented slice

Ticketry now ships the first full Codex Chat vertical slice described here:

- a durable `chat` `AgentRun` kind with session, append-only normalized event,
  and idempotent command persistence;
- a supervised `codex app-server` JSON-RPC runtime using checked schema
  snapshots from the installed CLI;
- creation, replay, follow-up turn, interrupt, approval, structured user-input,
  stop, and guarded process-resume APIs over REST and `/ws/chat`;
- a T3-derived Studio timeline with streamed Markdown, reasoning/activity
  folds, MCP tool arguments/results, token usage, plans, file-change diffs,
  durable drafts, live-edge following, and idempotent delivery-state recovery
  that fails closed at an unknowable backend-restart boundary;
- `Codex · Chat` launch and durable Chat tabs beside the existing Terminal
  surface, reusing Ticketry's worktree, prompt, MCP, skills, lifecycle, and
  run-history seams; and
- checked T3 provenance/notice files plus numbered Studio acceptance coverage.

The deliberately deferred items are rich image/file-mention input, a
real-provider browser E2E harness, per-run blocking-approval opt-in, short-lived
WebSocket authentication tickets, and transcript pagination/compaction for very
large histories. The deterministic acceptance case exercises the complete
browser contract; the real installed app-server handshake is verified
separately without spending a model turn. The current desktop support boundary
is POSIX: the sidecar watchdog contains the app-server process group, while
deliberate child `setsid()` escape and Windows job-object containment remain
follow-up hardening if those execution modes are introduced.

## Product model

Provider and presentation are independent choices:

- Provider: Codex initially; other providers are follow-up work.
- Run type: `terminal` or `chat`.
- A Terminal run keeps the current tmux/PTTY transport and terminal renderer.
- A Chat run starts a managed `codex app-server` subprocess and renders a
  durable structured transcript.
- Both are persisted as `AgentRun` records and use the same Ticketry scope,
  worktree, design directory, lifecycle, and WorkTracker MCP configuration.

The Studio launcher should therefore expose **Codex · Chat** in addition to the
existing provider-backed Terminal choices. Chat is not a fifth provider and
must not be represented as an agent slug such as `t3`.

## Upstream facts

The audited T3 revision is a React 19/Vite frontend backed by a Node WebSocket
server. Its server launches `codex app-server` and communicates through JSON-RPC
over stdio. T3 normalizes provider output into projects, threads, sessions,
turns, messages, activities, approval requests, proposed plans, and checkpoint
diffs.

The most relevant upstream source is:

| Capability | T3 Code source | Reuse mode |
| --- | --- | --- |
| Normalized thread/message/activity contract | `packages/contracts/src/orchestration.ts` | Adapt the types and discriminants; remove Effect Schema runtime coupling. |
| Codex protocol bindings | `packages/effect-codex-app-server/` | Use as the protocol reference and test-fixture source; generate Ticketry's checked contract from the installed Codex CLI. |
| Codex process/runtime behavior | `apps/server/src/provider/Layers/CodexProvider.ts`, `CodexAdapter.ts`, `CodexSessionRuntime.ts` | Port lifecycle and event-mapping behavior to Python; do not import the Node/Effect runtime. |
| Codex launch arguments | `apps/server/src/provider/Layers/codexLaunchArgs.ts` | Port substantially, including filtering config flags and using `codex app-server`. |
| Timeline derivation | `apps/web/src/session-logic.ts` | Transplant and adapt to Ticketry contract types. |
| Timeline row derivation and scroll behavior | `apps/web/src/components/chat/MessagesTimeline.logic.ts` | Transplant with tests and source header. |
| Transcript presentation | `apps/web/src/components/chat/MessagesTimeline.tsx` | Transplant by feature slice; replace T3 global stores and navigation callbacks with Ticketry props. |
| Markdown | `apps/web/src/components/ChatMarkdown.tsx` | Transplant with Ticketry-safe sanitization and styling. |
| Composer | `apps/web/src/components/chat/ChatComposer.tsx` and `ComposerPromptEditor.tsx` | Start with the plain turn composer; progressively enable mentions, images, and commands. |
| Approval UI | `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx` | Transplant when the backend request/response seam exists. |
| Diff rendering | `apps/web/src/lib/diffRendering.ts`, `components/DiffPanel*.tsx`, `components/diffs/AnnotatableCodeView.tsx` | Transplant logic and presentation using `@pierre/diffs`. |
| Terminal alongside chat | `apps/web/src/components/ThreadTerminalDrawer.tsx` | Use as presentation reference; connect to Ticketry's existing Terminal component instead of T3's terminal runtime. |

## What is copied versus ported

### Copy and adapt

Frontend code with limited infrastructure coupling should retain recognizable
T3 structure, names, behavior, and focused tests. Copied files must carry a
short source header containing the upstream repository, revision, path, and MIT
license pointer. Ticketry must include T3's copyright and MIT text in its
third-party notices.

The first copy candidates are the pure timeline/diff derivation modules. The
large `ChatView.tsx` file is not a copy candidate as one unit: at the audited
revision it is approximately 6,450 lines and imports T3 routing, environment,
preview, terminal, settings, Effect Atom, and client-runtime state.

### Port behavior

T3's provider runtime is Effect-heavy TypeScript and assumes its own Node
server, SQLite event store, queue-backed reactors, environment registry, and
checkpoint system. Ticketry already has Django ownership of `AgentRun`, work
items, worktrees, launch configuration, MCP wiring, and lifecycle state.

Adding T3's server unchanged would create two sources of truth and require a
packaged Node 22+ runtime. Instead, Ticketry's Python sidecar ports the narrow
Codex process manager and event-normalization behavior. This is the unavoidable
language boundary; it is not a reason to redesign the UI.

## Ticketry target seams

### Persistence

Extend `AgentRun` with a run-kind discriminator (`terminal` / `chat`). Chat-owned
persistence records the provider thread and active turn on the session, stores
an append-only sequence of normalized provider events (including messages,
activities, approvals, patches, usage, and terminal states), and keeps durable
command ledgers for launch and turn idempotency.

Transcript persistence is server-owned. A Studio reload reads a snapshot before
subscribing to live deltas. Provider-native history remains useful for resume,
but it is not Ticketry's transcript database.

### Launch

Keep the shared launch-fact resolution used by Terminal runs. Split only after
Ticketry has resolved the provider, prompt, cwd, design directory, work item,
model/reasoning settings, required skills, lifecycle URL, and MCP URL.

- Terminal branch: existing `terminals.launch._launch`, unchanged.
- Chat branch: persist a Chat `AgentRun`, spawn the approved Codex executable as
  `codex app-server`, initialize it, create/resume a provider thread, and start
  the initial turn.

The chat process manager belongs to the Python backend and must not be controlled
directly by the webview.

### Transport

Add a chat WebSocket with a checked JSON frame contract following Ticketry's
existing terminal wire-contract pattern:

- server snapshot containing the durable transcript;
- ordered message/activity/turn deltas;
- client commands for starting or interrupting a turn;
- approval and user-input responses;
- ready/error frames;
- reconnect from a durable sequence cursor.

Raw `codex app-server` messages never cross into Studio. Ticketry exposes the
normalized T3-derived contract so the frontend stays provider-neutral.

### Studio

Add Chat sessions to the selected-ticket workspace as closable tabs beside
document and terminal tabs. Keep one mounted Chat host per visible workspace in
the same way the Terminal host preserves live sessions across ticket switches.

The implemented Chat surface contains:

1. streamed user/assistant transcript;
2. structured work/tool activity;
3. follow-up composer;
4. stop/interrupt action;
5. reconnect and completed states;
6. approval and structured user-input panels that honor provider-advertised
   choices; and
7. visual file diffs, reasoning/activity folds, MCP arguments/results, token
   usage, and plans.

Image input and file mentions remain follow-up slices. Raw terminal access
continues to coexist as Ticketry's existing Terminal run/tab surface rather than
importing T3's terminal runtime.

## Dependency policy

The transplant may add focused frontend dependencies that implement visible T3
behavior, notably `react-markdown`, `remark-gfm`, `rehype-sanitize`,
`lucide-react`, `@legendapp/list`, and `@pierre/diffs`.

Do not add T3's entire package graph, Effect runtime, router, environment model,
or client-runtime state merely to make an upstream import compile. Ticketry is
currently React 18 and Tailwind 3; copied React 19-only calls such as `use()`
must be adapted to React 18 equivalents unless a deliberate React upgrade is
separately justified and tested.

## Delivery record

1. T3 attribution notice and generated Codex app-server schemas — complete.
2. `AgentRun.run_kind` plus Chat persistence — complete.
3. Tested Python JSON-RPC stdio client and Codex process manager — complete.
4. Durable first/follow-up turns, streaming deltas, tool activity, completion,
   interrupt, and guarded process resume — complete.
5. Chat creation/read/command APIs and checked WebSocket contract — complete.
6. `Terminal` / `Chat` launch choice in Studio — complete.
7. T3-derived timeline logic, transcript renderer, and composer — complete.
8. Approval/request rendering, structured input, diffs, reasoning, MCP detail,
   token usage, and plans — complete. Per-run blocking-approval opt-in remains a
   follow-up; autonomous execution stays the default.

Every user-visible Studio slice updates a numbered
`studio/src/test/*Acceptance.test.tsx` case and passes
`npm run test:overhaul --workspace @worktracker/studio` before handoff.

## Non-goals

- Replacing or parsing the existing terminal transport.
- Treating T3 Code as a provider or agent executable.
- Running T3's full Node server beside Ticketry.
- Rebuilding T3's project/worktree database inside Ticketry.
- Hiding copied-code provenance.
