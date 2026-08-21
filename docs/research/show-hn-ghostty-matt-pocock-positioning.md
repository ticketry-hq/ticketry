# Fact-check: Ghostty and Matt Pocock positioning

Research snapshot: 2026-08-21. External sources are limited to first-party
material from Matt Pocock, the `mattpocock/skills` repository, and the Ghostty
project. Local implementation claims are checked against the current Ticketry
workspace. This note evaluates the proposed positioning phrase but does not
write or revise HN copy.

## Overall verdict

The phrase is not factually safe as written.

Ticketry really does embed `libghostty`, and it really does package and use a
pinned selection of Matt Pocock's skills. The phrase joins those facts into a
relationship the sources do not support. Matt's public material calls his
system an engineering-skill "main flow," not a terminal workflow. Ghostty is
Ticketry's native terminal renderer and transient tmux viewer, not the basis of
the work-management and agent-launch control plane.

## Claim-by-claim verdict

| Implied claim | Verdict | Evidence |
| --- | --- | --- |
| Ticketry is Ghostty-based | **True with a precision caveat.** The macOS release embeds a statically linked `libghostty` build through its C API. It does not merely open or wrap the Ghostty desktop app. | Ticketry pins Ghostty commit `332b2aef`, checks the prepared revision, and links `libghostty.a` plus Metal/AppKit frameworks ([build script](../../studio/src-tauri/build.rs#L5-L88)). That commit is Ghostty's [`1.3.1` commit](https://github.com/ghostty-org/ghostty/commit/332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28). Ghostty describes `libghostty` as its C-compatible embedding library ([Ghostty README](https://github.com/ghostty-org/ghostty#cross-platform-libghostty-for-embeddable-terminals)). |
| The control plane is based on Ghostty | **Misleading.** Ghostty supplies the native terminal surface. Ticketry's backend, WorkTracker state, launch policy, MCP tools, and execution engine perform control-plane work. | Ticketry's native module says `libghostty` owns the renderer-facing PTY and launches a validated tmux attach command, while tmux owns the durable session and the surface is a transient viewer ([native terminal boundary](../../studio/src-tauri/src/native_terminal.rs#L1-L5)). Ticketry's own architecture calls its HTTP session API the control plane and the terminal byte stream the data plane ([terminal service](../eventcatalog/domains/workspace-runtime/systems/workspace-runtime-system/services/terminal-service/index.mdx#L30-L32)). |
| Matt Pocock has a named or described "terminal workflow" matching Ticketry | **Not supported by the reviewed first-party sources.** He documents a tool-independent engineering-skill chain. I found no first-party description of that chain as a Ghostty, tmux, or terminal workflow. | Matt's current official skills page calls it the "Main Flow" and lists `grill-with-docs`, `to-spec`, `to-tickets`, `implement`, and `code-review`. The same page says the skills are plain files and work across agents ([AI Hero skills](https://www.aihero.dev/skills)). The documentation at Ticketry's pinned upstream revision calls the same sequence the "main build chain" ([pinned `to-spec` documentation](https://github.com/mattpocock/skills/blob/ed37663cc5fbef691ddfecd080dff42f7e7e350d/docs/engineering/to-spec.md#where-it-fits)). Neither source makes Ghostty or tmux part of the flow. |
| Ticketry implements Matt's workflow | **Partly true, but too broad without qualification.** Ticketry operationalizes several upstream skills inside its own larger workflow. It is not a literal implementation of his full published chain. | Ticketry vendors six selected packages at upstream commit `ed37663c`: `code-review`, `grill-with-docs`, `implement`, `tdd`, `to-spec`, and `to-tickets` ([skill lock](../../backend/apps/terminals/agents/skills/lock.json#L8-L25)). Its actual entry skills are only `grill-with-docs`, `to-spec`, and `to-tickets`; Ticketry supplies its own Ideas, Implement, Review, transition, work-item, MCP, and dependency-graph behavior ([reviewed defaults](../../backend/worktracker/reviewed_defaults.json#L14-L120)). The upstream `implement` skill itself expects one ticket, TDD, review, and a commit ([pinned `implement`](https://github.com/mattpocock/skills/blob/ed37663cc5fbef691ddfecd080dff42f7e7e350d/skills/engineering/implement/SKILL.md)); Ticketry's Implement stage instead coordinates its own child-ticket campaign and provider runs. |
| Ticketry always runs Matt's exact skill bytes | **False.** The pinned copy is a fallback, not a mandatory runtime identity. | Ticketry accepts an existing provider-visible skill with the same canonical name and deliberately preserves user-owned or edited copies ([installation policy](../../backend/apps/terminals/agents/skills/installation.py#L258-L367)). A user's run can therefore use a same-named skill whose contents differ from the pinned upstream snapshot. |
| Naming Matt establishes endorsement or collaboration | **Unsupported and risky.** Attribution is substantiated; endorsement is not. | The lock records the MIT-licensed upstream repository, revision, and copyright attribution ([skill lock](../../backend/apps/terminals/agents/skills/lock.json#L8-L15)). In the reviewed first-party sources, I found no Matt Pocock mention of Ticketry and no statement that he uses, endorses, or collaborated on it. The possessive construction can reasonably be read more strongly than the verified relationship. This is an inference from the absence of any first-party product relationship plus the narrower, documented dependency. |

## Precise Ghostty relationship

Ticketry's release build enables the `native-libghostty` feature and prepares a
pinned Ghostty revision ([release manifest check](../../studio/scripts/release-build.mjs#L35-L49)).
The native macOS view uses the embedding API and Metal renderer. For each live
run, `libghostty` launches a validated `tmux attach-session` command in its own
PTY. The tmux session survives viewer attachment and detachment. If the native
surface is unavailable or fails, Studio uses its xterm.js/WebSocket compatibility renderer
([tmux command viewer](../../studio/src-tauri/src/tmux_viewer.rs#L123-L160),
[fallback selection](../../studio/src/features/agents/terminal/Terminal.tsx#L123-L159)).

So Ghostty is a real, substantial part of the user-facing terminal. It does not
own tickets, workflow transitions, dependency scheduling, provider selection,
agent launch policy, or durable session lifetime.

## Precise Matt Pocock relationship

The strongest supportable relationship is dependency and adaptation:

- Ticketry keeps an unmodified, integrity-checked snapshot of selected packages
  from `mattpocock/skills` at a specific commit and retains the MIT attribution.
- It invokes the planning portion of the published main flow at named workflow
  stages.
- It supplies the tracker, workflow state machine, MCP operations, dependency
  graph execution, provider adapters, tmux sessions, and UI around those skills.
- Its runtime can defer to a user's same-named skill, so not every run is
  guaranteed to execute Matt's pinned text.

That evidence supports explicit attribution in explanatory material. It does
not support presenting Ticketry as Matt's own terminal workflow, a product made
for his personal setup, or an endorsed implementation.

## Source-set limitation

No search can prove that a person has never used a phrase. The negative finding
here is scoped to Matt's official AI Hero skills pages, his public skills
repository including Ticketry's pinned commit, and first-party searches for
Ticketry, Ghostty, tmux, and terminal-workflow references. The positive public
name for the relevant system is "Main Flow" or "main build chain," and its
documented components are agent skills rather than terminal infrastructure.
