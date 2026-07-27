# Agent SDLC Workflow

The vocabulary of how launched agents drive work items through the gated SDLC by
prompt — the launch-prompt substrate (`prompts.py`) and the discovery skills the
prompts point agents at. Not the tracker's storage model (that is worktracker);
this context is about what an agent is *told to do* in a given state.

## Language

### Discovery skills

**Wayfind**:
Discovery of _what features to build_ — charting a fog too big to be one Story
into the set of Stories/tasks it decomposes into. Operates _above_ the Story:
its output is an epic and its child Stories. Run when you don't yet know what the
work items even are.
_Avoid_: pathfind (that is the intra-Story counterpart), planning

**Pathfind**:
Discovery of _how to implement a known task_ — the implementation details, approach,
and spec of a single Story already on the tracker. Operates _inside_ one Story in
Refinement, spinning PathFind children to close discovery threads, converging to
that Story's spec + HLD. Run when the Story is known but its implementation is foggy.
Its opening move is the **split**: autonomously creating one PathFind child per
discovery thread (grilling threads, research threads) — the split is a phase of
pathfind, not a separate skill or stage.
_Avoid_: wayfind (that is the cross-Story counterpart), split/divide as standalone terms

**Grilling** (`grill-with-docs`):
A synchronous, relentless interview with the human to sharpen one plan in one
session, emitting ADRs + glossary. A _technique_ a pathfind session uses, not a
tracker-structuring activity — it produces no child tickets on its own.

**Custom stage prompt**:
Profile-supplied guidance for one SDLC stage, selected in place of that stage's
built-in prompt when an agent is launched.
_Avoid_: prompt restyling, partial override

**Workflow prompt binding**:
Opaque user-authored agent guidance selected by the combination of work-item type and current workflow state. It may describe any domain activity and carries no built-in software-development semantics.
_Avoid_: global state prompt, coding-stage prompt, state description

**Application launch prompt envelope**:
One application-owned pre-prompt and post-prompt that surround every agent launch prompt. The envelope is changed only in the app, augments an already-valid launch, and never changes a running session or makes a promptless workflow binding launchable.
_Avoid_: user-configurable prompt, project prompt, profile prompt, fallback workflow prompt

**Workflow launch configuration**:
The independently inheritable prompt, agent/provider, model, and reasoning defaults selected by a work item's type and current workflow state. Provider-specific values are validated together; unset values inherit only from explicitly configured profile/provider choices.
_Avoid_: edge launch configuration, parent-depth configuration, required launch form

**Activated provider**:
A built-in coding-agent provider (claude, codex, gemini) the host has enabled in Settings. Activation is host-wide and lives outside the code-owned adapter set; the four adapters still exist in code, but only activated ones appear in launch selectors. A launch bound to a non-activated provider is blocked, never silently redirected to another provider.
_Avoid_: installed provider, available adapter, provider catalog entry

**Global launch default**:
The single host-wide (provider, model, reasoning) triple applied wherever a workflow launch configuration leaves those values unset and for every automated launch. It is resolved live at launch time — never snapshotted into a binding — and its provider must be an activated provider, so it cannot be left dangling by a deactivation.
_Avoid_: per-provider default, default profile, fallback binding, snapshotted default

**Launchable workflow binding**:
A work-item type and current-state binding that resolves a non-empty workflow prompt. Without a prompt, agents cannot be launched manually or by an automated transition from that state.
_Avoid_: promptless launch, implicit default prompt, edge-only launchability

**Automated launch attempt**:
An agent-start event requested after a committed transition traverses an automation-enabled edge. Its success or failure is independent of the state transition and can never roll that transition back.
_Avoid_: atomic transition launch, transition side effect rollback

**Automation gate**:
The policy on one legal workflow edge that decides whether completing that transition launches an agent. The destination state determines the launched agent's prompt, model, and reasoning defaults; transition legality remains separate.
_Avoid_: transition gate, auto-transition, prompt gate

**Research**:
Unattended investigation of a question against primary sources, emitting a findings
`.md`. A technique a pathfind (or wayfind) session delegates a thread to.

### Work-item types

**PathFind** (issue type):
A child work item representing _one discovery thread_ of a parent Story's Refinement.
Planning-only: it resolves a decision or gathers findings and writes them into the
Story's design directory; it never produces product code or Implementation tickets.
Terminal (Done/Cancelled) PathFind children are what let the parent Story leave Refinement.
_Avoid_: spike, wayfinder ticket

**Implementation** (issue type):
A child work item representing a buildable slice of a Story, created only at
Refinement convergence, wired into a `blocked_by` DAG. Built during Implement.

**Story** (issue type):
A work item that carries a feature through the canonical SDLC (Idea → Refinement →
Ready → Implement → Review → Done). Leads its own Refinement discovery.

### Stages

**Refinement exit deliverable**:
The artifacts a Story must possess before it may leave Refinement:
spec, HLD/LLD, and its Implementation children. Generated at the tail end of
Refinement (convergence), never in Ready. Whether the active stage prompt asks the
agent to request the legal transition is prompt policy, not caller identity.

**Caller-neutral transition policy**:
Stage-prompt guidance may require or withhold a legal workflow transition, but it
does not reserve that transition for a human caller. Every requested move still
uses the coding agent status tool and the canonical workflow state machine.
_Avoid_: human gate, agent bypass, automatic transition

**Ready** (stage):
A pure prioritization queue of fully-specified Stories awaiting build capacity.
Inert: no agent machinery fires on entering or sitting in Ready.
_Avoid_: treating Ready as a working state that generates artifacts
