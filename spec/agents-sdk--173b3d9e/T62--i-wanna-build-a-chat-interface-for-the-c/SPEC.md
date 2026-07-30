# T62 — Research Codex Chat Architecture

Status: Refined
Story: WorkTracker #62 (`8171a229-1e20-4fb4-ae07-34b64ecdb2f0`)
Module: coding (`173b3d9e-3790-4d52-989f-202634e54ccf`)
Date: 2026-07-30

## Summary

This is a **research spike**. It ships no production code. It produces the
document that answers *how Ticketry will present an agent run as a chat rather
than a terminal*, grounded in how open-source projects that already did it —
primarily **T3 Code** (MIT, TypeScript) and **Zed** (via `codex-acp`) — actually
did it, and validated by real captured event traces rather than by assertion.

The spike is scoped by one already-settled architectural conclusion and one
already-settled topology:

- **Chat messages come from a structured protocol spoken to a managed
  subprocess, not from parsing PTY bytes.** Both reference projects converge on
  this; neither screen-scrapes a TUI.
- **A Chat run and a Terminal run are distinct run kinds that coexist.** The
  existing tmux/PTY path is not modified, migrated, or deprecated by this work.

Everything else — which protocol, who owns the transcript, whether resume
survives, how the Studio surface decomposes — is what the spike exists to
determine.

## Problem Statement

Watching an agent work in Ticketry today means watching a terminal. That is the
only surface there is, and it has three consequences the user feels directly.

**Nothing is durable.** The conversation exists only as pixels. Reload the
window and the reasoning that led to a decision is gone; the only history is an
in-memory xterm scrollback buffer plus whatever tmux copy-mode still holds. No
agent run in Ticketry can be re-read after the fact, quoted, diffed against
another run, or handed to someone else.

**Nothing is structured.** A tool call, the model's reasoning, a proposed file
edit, and an error are all the same thing: bytes. The product cannot render a
diff, cannot show what a tool was called with, cannot show token spend, cannot
link a file mention to the file, and cannot let the user approve or reject a
step — because none of those concepts exist in the transport.

**Nothing is supervisable.** Every provider is launched fully bypassed. The user
is a spectator of a terminal, not a participant in a conversation.

Meanwhile the feature the codebase *calls* chat is not one: "document chat" is an
ordinary tmux terminal rendered inside a 75%-width overlay. There is no message
list, no composer, and no turn model anywhere in the repository. So this is not
an improvement to an existing chat surface — it is the first one, and the
architecture for it does not exist yet.

## Solution

Produce, before any code is written, a verified target architecture for a **Chat
run**: an agent run whose transport is a structured event protocol and whose
surface is a durable, replayable transcript with a composer.

The spike reaches that document by studying four sources against one fixed
rubric, proving the central mechanism works with a throwaway end-to-end spike,
and then committing a design plus a dependency-ordered roadmap and a decision
record.

Deliberately, the spike **borrows patterns and not code**. Nothing is vendored,
forked, or bundled; there is no new runtime in the desktop application and no
license surface. The reference projects are read for their event models, adapter
boundaries, and UI decomposition — the parts that are expensive to get right and
cheap to learn from.

## Verified starting state

Every claim below was read from the working tree on 2026-07-30 and carries a
citation. These are the facts the spike must not contradict.

### How a Codex run is launched today

`_command_codex` builds the **interactive TUI** invocation
`codex [--model M] [-c model_reasoning_effort="R"] PROMPT`
(`registry.py:350`). `_inject_codex` then adds `-c hooks=<TOML>`,
`-c mcp_servers=<TOML>`, `-c approvals_reviewer="auto_review"`, and
`--dangerously-bypass-hook-trust` (`codex.py:136`). Native resume is
`codex resume <provider_session_id>` (`registry.py:317`).

The active Codex builder and injector emit **no** `exec`, `--json`, `proto`,
`experimental`, or `app-server` token anywhere (`registry.py:317`,
`registry.py:350`, `codex.py:136`). `codex exec` and JSON output capture appear
only in unrelated design material for a separate headless primitive
(`spec/worktracker--81c3aa9b/T780--orchestrator-module/BRIEF.md:43`). There is
therefore no existing structured-transport code to extend — this is greenfield.

The launched command is shell-joined behind `env -u NO_COLOR` and run inside a
detached tmux session created with `remain-on-exit`, manual window sizing, and
`@pt-*` metadata, whose setup shell is replaced by `respawn-pane`
(`launch.py:219`, `sessions.py:69`, `sessions.py:135`).

All four providers are launched with permissions bypassed:
`--allow-dangerously-skip-permissions` (claude), `--dangerously-skip-permissions`
(agy), `approvals_reviewer="auto_review"` + `--dangerously-bypass-hook-trust`
(codex), `--approval-mode yolo` + `--skip-trust` (gemini) (`registry.py:309-361`).

### The transport

Viewing attaches over `/ws/terminal`. The consumer runs
`tmux -L <socket> attach -t <session>` inside a `ptyprocess` PTY and pumps bytes
both ways (`consumers.py:262`, `consumers.py:327`).

`wireContract.ts` declares the **complete** JSON frame union — `init` (with an
explicit `spawn`/`attach` mode discriminant), `resize`, `scroll`, `ready`,
`error` — mirrored by `frames.py:87` and validated in CI against the committed
`wire-frames.schema.json`. Terminal bytes travel **outside** that union as binary
WebSocket messages (`browserTerminalClient.ts:130`, `consumers.py:328`).

### What is and is not persisted

`AgentRun` stores identity, provider, status, timestamps, exit code, error, cwd,
`provider_session_id`, latest lifecycle state, design directory, predecessor run,
and scope (`runs/models.py:8`). `AgentTerminalSession` stores the tmux session
name, scope, and optional document path (`terminals/models.py:6`).
`AgentRunViewerLease` enforces a single viewer per run (`terminals/models.py:39`).

**No model stores stdout, PTY bytes, terminal cells, scrollback, messages, turns,
tool calls, or a transcript** (`runs/models.py:8`, `terminals/models.py:6`).
Frontend scrollback is an in-memory pooled xterm buffer that survives only within
one frontend process (`entryPool.ts:96`). Server-side history is tmux copy-mode;
reattach lets tmux redraw rather than loading a stored replay (`client.py:35`).
Conversation content lives exclusively inside provider-native session files that
Ticketry never reads — resume works by handing the provider its own session ID
back (`session.py:310`, `session.py:330`).

**This is the single largest cost of moving to a managed subprocess: tmux is what
makes a session survive today, and a subprocess is not tmux.**

### The structured pipeline that already exists

Provider session IDs come from **lifecycle hooks, not terminal output**
(`codex_hook.py:31`). The shared reporter posts them as `provider_session_id`
(`_reporter.py:104`); `/api/lifecycle/events` persists and reduces them
(`runs/api.py:70`) and publishes a typed delta via `publish_status` to a
project-scoped Channels group (`bus.py:20`). `StatusStreamConsumer` serves a
durable initial snapshot then forwards frames over receive-only `/ws/status`
(`runs/consumers.py:39`). `statusFeed.dispatch` switches on frame type
(`statusFeed.ts:40`).

So a typed, durable-snapshot, server→client structured stream already exists. It
carries lifecycle state and no message bodies (`contracts.py:154`), but the
**shape** a transcript stream needs is already established in this codebase.

### "Document chat" is a terminal

`openDocChat` creates an ordinary `SessionMeta` with `isDocChat: true`, indexes it
by `bucket::docRelPath`, excludes it from ordinary tabs, and then uses the same
REST creation, tmux session, PTY stream, and terminal renderer as every other
session (`sessionStore.ts:375`). `WorkspacePane` renders it as a scrim plus a
~75% overlay containing `WorkspaceTerminalHost`; **no message-list, composer, or
turn component is rendered** (`WorkspacePane.tsx:1190`). Backend support is a
scope value plus `doc_rel_path` (`terminals/models.py:23`).

The word "chat" is therefore already taken in this codebase, and it means
"terminal".

### What the reference projects actually do

**Zed** does not parse terminal output. It runs `codex-acp` — a Rust adapter — as
a separate process speaking **JSON-RPC over stdio** using the Agent Client
Protocol, which implements the ACP `Agent` trait, translates ACP requests into
Codex operations, and streams Codex events back as ACP `SessionUpdate`
notifications. ACP is an open standard (Apache-licensed) with adapters for Codex
CLI, Claude Code, and Gemini CLI.

**T3 Code** (MIT, TypeScript, Effect ecosystem) has the same shape: the browser
holds a WebSocket to a small local Node server; that server launches the provider
CLI as a subprocess and speaks **JSON-RPC over stdio** to it, then streams
normalized structured events to the UI. Providers sit behind a common adapter
interface handling protocol translation, session lifecycle, and event
normalization. Its features include markdown-rendered threaded chat, a terminal
drawer, visual diffs, and git-worktree-per-task.

**`codex app-server`** is a JSON-RPC 2.0 server inside the Codex CLI itself,
powering OpenAI's own VS Code extension and desktop app. Transport is
newline-delimited JSON over stdio (documented stable; a WebSocket transport
exists but is experimental). A client calls `turn/start` with a `threadId`, reads
notifications, and receives `turn/completed` with final state and token usage. It
can emit its own contract via `codex app-server generate-ts` and
`codex app-server generate-json-schema`.

The consensus is unambiguous: **CLI as subprocess, JSON-RPC over stdio,
normalized events, adapter per provider.** Nobody parses the TUI.

## User Stories

Stories 1–14 are the spike itself. Stories 15–33 are the eventual product
capability the architecture document must be judged against — they are the rubric,
not this story's deliverables.

### The spike

1. As the Ticketry maintainer, I want a single document that states how we will
   build a chat interface, so that the follow-on build starts from a decision
   rather than from a debate.
2. As the maintainer, I want that document grounded in projects that already
   shipped this, so that we inherit their solved edge cases instead of
   rediscovering them.
3. As the maintainer, I want T3 Code's source read in depth, so that I know
   precisely which of its ideas transfer to a Django/React stack and which are
   Effect-ecosystem-specific and irrelevant to us.
4. As the maintainer, I want Zed's agent panel and `codex-acp` read for patterns,
   so that I learn how a mature editor models streaming updates, tool-call
   rendering, diff review, and permission requests.
5. As the maintainer, I want the `codex app-server` and ACP specifications read
   side by side, so that I can judge the reference projects' choices rather than
   cargo-culting them.
6. As the maintainer, I want a breadth scan of other agent GUIs, so that I know
   whether subprocess-plus-JSON-RPC is genuine consensus or just what two
   projects happened to pick.
7. As the maintainer, I want every factual claim in the research to cite a repo
   `file:line`, an upstream source location, or a committed trace, so that any
   claim can be re-checked instead of trusted.
8. As the maintainer, I want each source evaluated against the same four
   capabilities, so that the notes are comparable rather than four unrelated
   summaries.
9. As the maintainer, I want real multi-turn event traces captured from the CLI
   and committed, so that the design rests on observed behaviour rather than on
   documentation that may lag the tool.
10. As the maintainer, I want a throwaway end-to-end spike on a never-merged
    branch, so that we prove a second turn and a resume actually work before
    anyone plans a build around them.
11. As the maintainer, I want the transcript-durability question answered
    explicitly, so that we go in knowing what replaces the guarantee tmux gives
    us today.
12. As the maintainer, I want a phased, dependency-ordered roadmap, so that the
    follow-on story is nearly free to refine.
13. As the maintainer, I want an ADR for the transport and topology choice, so
    that a future reader who finds two live transports understands why.
14. As the maintainer, I want the existing "chat means terminal" naming collision
    documented, so that the vocabulary is honest before four tickets and a build
    start using the word.

### The capability being designed for

15. As a Ticketry user, I want assistant output rendered as streamed markdown, so
    that I can read explanations, lists, and code blocks instead of ANSI.
16. As a user, I want my own turns shown in the transcript, so that I can see
    what I asked and when.
17. As a user, I want reasoning shown as a distinguishable, collapsible block, so
    that I can follow the agent's thinking without it drowning the answer.
18. As a user, I want each tool call shown with its name, arguments, and result,
    so that I can see what the agent actually did rather than inferring it.
19. As a user, I want a composer that sends a new turn into a live session, so
    that chat is a conversation and not a log.
20. As a user, I want to see token usage for a turn, so that I understand what a
    run is costing me.
21. As a user, I want the transcript to survive a page reload, so that I do not
    lose the reasoning behind a change.
22. As a user, I want the transcript to survive a backend restart, so that a
    sidecar bounce does not erase a day's work.
23. As a user, I want to reattach to a run from a different window and see the
    full history, so that the transcript is a property of the run and not of my
    tab.
24. As a user, I want to re-read a completed run's transcript, so that I can
    review what an unattended agent did.
25. As a user, I want proposed file edits rendered as a visual diff, so that I can
    review a change without leaving the conversation.
26. As a user, I want the option of a blocking permission request in the
    transcript, so that I can supervise an agent when I choose to.
27. As a user, I want autonomous execution to remain the default, so that
    unattended and orchestrated runs are not broken by a supervision feature.
28. As a user, I want to keep using the terminal for a run, so that nothing I do
    today regresses.
29. As a user, I want to open a terminal alongside chat when I need raw shell
    access, so that chat is not a cage.
30. As a user, I want a chat run to reuse the same worktree, work-item scope,
    design directory, and WorkTracker MCP wiring as a terminal run, so that a
    chat agent is as capable as a terminal agent.
31. As a user, I want chat runs to appear in the same run lifecycle surfaces —
    subtree lifecycle chicklets, the status feed, run history — so that there is
    one place to see what is running.
32. As the maintainer, I want the internal chat-event model to be
    provider-agnostic, so that Claude, Agy, and Gemini adapters can follow
    without reshaping the core.
33. As the maintainer, I want the desktop application to gain no new bundled
    runtime, so that packaging complexity does not grow.

## Implementation Decisions

These are settled. The spike must respect them and is not chartered to relitigate
them.

### D1 — Event source: structured protocol, managed subprocess

Chat messages come from a machine-readable protocol spoken to a managed
subprocess. PTY parsing is rejected: it is screen-scraping a TUI whose layout
changes every release, and it is structurally incapable of yielding tool-call
arguments, token counts, or an approval hook. Neither reference project does it.

The accepted cost is explicit: the chat path leaves tmux, and therefore leaves
the durability and attach guarantees tmux currently provides. Replacing that
guarantee is a first-class question for the spike, not a footnote.

### D2 — Topology: Chat run and Terminal run coexist

A run is launched as **either** a Terminal run (tmux/PTY, unchanged) **or** a Chat
run (managed subprocess, structured events). A single run cannot be both — an
interactive TUI and a JSON-RPC server are different processes.

Both are `AgentRun`s and share identity, lifecycle reporting, worktree
resolution, prompt construction, MCP injection, design-directory conventions, and
work-item scope. They diverge **only** at transport and presentation. The terminal
path is not modified, migrated, or deprecated by this work.

### D3 — Borrow mode: patterns only

No code is vendored, forked, or bundled. No Node sidecar. No second supervised
process. No new runtime inside the Tauri application. Consequently there is no
license surface and no attribution obligation — this supersedes the story
description's "t3-code is MIT, I wanna rip it off".

The reference projects are read for their event vocabulary, adapter boundary, and
UI decomposition. The rationale is that Django already owns launch, lifecycle
hooks, worktrees, MCP injection, and `AgentRun` identity; duplicating that in a
Node service would fork the source of truth for session identity.

### D4 — Vocabulary: Chat run, Terminal run

The spec, the architecture document, the tickets, and the eventual code use **Chat
run** and **Terminal run**.

This collides with existing usage, and the collision is documented rather than
resolved here: `scope: "docchat"`, `chatByDoc`, `openDocChat`, `is_doc_chat`, and
`AgentPicker`'s `doc-chat` mode all currently denote **terminals**. The spike
records this and proposes renaming them to *document terminal* as a **separate
follow-up ticket**. A rename is not dragged into a research spike.

### D5 — Approvals: design for both, default autonomous

A genuinely blocking permission request must be representable in the event model
and in the UI, because that is a protocol capability we would otherwise discover
too late to retrofit. Chat runs nonetheless keep today's bypassed posture by
default, so unattended and orchestrated runs continue to complete without a human
present. Gating is opt-in per run.

### D6 — Provider-agnostic model, Codex-only proof

The internal chat-event model must be provider-agnostic and sit behind a
per-provider adapter, matching the pattern both reference projects use. Only the
**Codex** adapter is proven by this spike. The other three providers are a
roadmap item, not a deliverable.

### D7 — Preferred seams for the architecture document

The architecture document must prefer these existing seams and justify any new
one. The target is the fewest possible seams.

- **`AgentAdapter`** (`command` / `augment_launch` / `resume_command`) is already
  the one place provider-specific invocation lives. A chat transport is another
  adapter capability, not a parallel subsystem.
- **`_launch`** already receives built launch facts, owns augmentation and
  `AgentRun` persistence, and is already separated from cols/rows/PTY/pumping —
  it is deliberately transport-agnostic.
- **`POST /api/terminals` / `CreateTerminalRunBody`** already creates a durable
  run with no viewer geometry; the viewer attaches afterwards with only
  `agent_run_id`.
- **lifecycle events → `publish_status` → `/ws/status` → `statusFeed.dispatch`**
  is an existing typed, project-scoped, server→client structured stream with a
  durable initial snapshot.
- **`TerminalClientTransport.attach`** is already the interface `entryPool`
  depends on instead of WebSocket directly.
- **`wireContract.ts` + committed `wire-frames.schema.json` + its contract test**
  is the established pattern for a single-source frame contract enforced in CI,
  and is the pattern a chat frame contract should follow.

### D8 — Open questions the spike must answer

These are outputs, not inputs. A design document that does not answer all five is
incomplete.

1. **Which protocol.** `codex app-server` versus ACP versus something else,
   decided on evidence — including whether adopting ACP's `SessionUpdate`
   vocabulary as our internal model is worthwhile independently of using its
   adapters.
2. **Who owns the transcript.** Our database, provider-native session files, the
   client, or a combination — and what replaces the durability tmux gives us.
3. **Whether resume works.** Whether a structured session can be resumed at all,
   whether the existing hook-captured `provider_session_id` is the right handle,
   and what the relationship is between a provider thread and an `AgentRun`.
4. **Studio decomposition.** The component boundaries for transcript, turn, tool
   call, diff, approval, and composer, and where the chat surface sits relative to
   `WorkspacePane` tabs and the existing overlay.
5. **Process supervision.** Who owns a subprocess's lifetime, what happens to a
   chat run when the sidecar restarts, and how the single-viewer lease concept
   translates when there is no PTY.

## Testing Decisions

This spike writes **no test code**. Verification has exactly two seams.

### Seam 1 — the citation rule

Every factual claim in every research note and in the architecture document must
cite one of: a repository `file:line`, an upstream source file or specification
section, or a committed trace. An uncited assertion is a defect in the
deliverable. Claims about event shapes may not rest on prose documentation alone
where a trace could have been captured.

This mirrors the standard the "Verified starting state" section of this spec is
held to, and the style of prior refined specs in `spec/`.

### Seam 2 — traces as future fixtures

The captured newline-delimited event traces and the CLI-generated JSON schema are
committed into the design directory as the spike's executable evidence, and are
explicitly framed as the fixtures the eventual implementation's contract test will
validate against.

Prior art is deliberate here: this repository already commits
`wire-frames.schema.json` and validates frame builders against it in CI
(`wireContract.ts:1-13`), and already commits `openapi.json` as a checked contract
with `test_openapi_contract.py`. The chat transport should inherit that pattern
rather than invent one, and these traces are the seed.

A trace set is adequate only if it covers, in one session: a first turn, streamed
assistant text, a reasoning block, a tool call with arguments and result, a
proposed file edit, an approval interaction, a token-usage report, turn
completion, a **second** turn in the same session, and a **resume** after process
exit.

Nothing else is tested. In particular, no CI check, schema-drift guard, or
production wiring is added by this story — that would cross the no-implementation
line.

## Out of Scope

- **Any production code.** Nothing lands in `backend/` or `studio/`. No models, no
  migrations, no endpoints, no components, no adapter implementation.
- **Any change to the Terminal run path.** tmux, `/ws/terminal`, the PTY pump,
  `wireContract.ts`, the viewer lease, Ghostty/xterm selection, and the entry pool
  are read but not touched.
- **The `docchat` → *document terminal* rename.** Documented as a collision,
  proposed as a follow-up ticket, not performed.
- **Reversing the permissions bypass anywhere.** D5 requires that blocking
  approval be *representable*; it does not change any provider's current launch
  flags.
- **Adapters for Claude, Agy, and Gemini.** The model must generalise to them; only
  Codex is proven.
- **Vendoring, forking, or bundling any third-party project**, and therefore any
  new bundled runtime, second sidecar, or packaging change to
  `backend/packaging/muxed-backend.spec`.
- **CI changes**, including a schema-drift check.
- **`CONTEXT.md` / `CONTEXT-MAP.md` edits.** The vocabulary lives in this spec and
  the architecture document for now.
- **Committing the throwaway spike branch.** It is explicitly never merged.
- **Choosing the protocol in this spec.** That is D8.1, the spike's job.

## Further Notes

**The two risks worth carrying forward.**

*Durability is the real cost.* tmux is why a Ticketry session survives a window
close, a reload, and a backend restart today. A managed subprocess has none of
that for free. If the spike cannot produce a credible durability story, D1 should
be reconsidered rather than shipped on optimism — that outcome is a legitimate
result of the spike, not a failure of it.

*"Multi-provider from day one" and a Codex-titled spike pull against each other.*
The resolution recorded in D6 is that the internal event model must be
provider-agnostic while only the Codex adapter is proven. If the research shows
the protocols are too semantically divergent to normalise cheaply, say so
explicitly rather than papering over it with an abstraction that only fits Codex.

**The throwaway spike exceeds the story's original wording.** The story says "No
implimentation, only documentation". A discardable end-to-end spike was
nonetheless authorised deliberately, on the grounds that the entire design rests
on an empirical claim — that a structured Codex session delivers streamed text,
reasoning, tool calls with arguments, diffs, approvals, and token usage, and can
be resumed. If that claim is wrong, the document is fiction. The mitigation is
that the branch is never merged and no code enters `backend/` or `studio/`.

**A useful accident of the existing architecture.** Provider session IDs already
arrive via lifecycle hooks rather than by scraping terminal output
(`codex_hook.py:31`), and there is already a typed project-scoped structured
stream with a durable initial snapshot (`bus.py:20`, `runs/consumers.py:39`). The
codebase is better positioned for structured chat events than the terminal-only
surface suggests, and the architecture document should exploit that rather than
building a parallel pipeline.

**Design directory.** All deliverables land in
`spec/agents-sdk--173b3d9e/T62--i-wanna-build-a-chat-interface-for-the-c/`,
alongside this spec. The ADR lands in `docs/adr/`, which does not yet exist and
which this story creates.
