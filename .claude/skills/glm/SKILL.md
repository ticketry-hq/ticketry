---
name: glm
description: Design deep-module interfaces, then fan out implementation behind them to GLM 5.3 Flash writers through OpenCode in the shared checkout. Use only when the user explicitly invokes /glm.
argument-hint: <task, ticket, or spec path>
disable-model-invocation: true
user-invocable: true
compatibility: Requires an authenticated OpenCode CLI with opencode-go/glm-5.3-flash access.
---

# GLM fan-out

Use OpenCode workers pinned to `opencode-go/glm-5.3-flash` with the `high`
reasoning variant. They implement behavior behind frozen interfaces in the
shared checkout. Claude owns module boundaries, interface contracts, file
ownership, review, verification, and the final answer. Claude may write
interface code and contract tests in the main context, but must not implement or
repair delegated hidden behavior itself.

## Task

$ARGUMENTS

If the task is unclear from the arguments and conversation, ask only for the
missing scope that changes implementation.

## Guard the shared checkout

1. Run `${CLAUDE_SKILL_DIR}/scripts/run-glm.sh check` and record
   `git status --short` plus `git rev-parse HEAD`.
2. Never stash, reset, discard, stage, or commit pre-existing changes.
3. All writers see the same working tree. Distinguish pre-existing changes from
   the requested work before assigning ownership. A dirty file may have only one
   writer, and its prompt must require preserving the existing edits.

## Design deep modules first

Read the repository instructions and enough code to divide the task by hidden
implementation responsibility rather than file count. Before fan-out, define
each module's:

- single purpose and owner;
- small public interface, including inputs, outputs, errors, and side effects;
- invariants and transactional or concurrency boundary;
- dependencies on other modules;
- implementation and test files hidden behind the interface.

Prefer a small stable interface that hides substantial behavior. Reject shallow
wrappers that expose storage details, internal steps, or one method per field.
Use the repository's generated contracts and framework seams instead of adding
parallel DTO, repository, or RPC layers.

Establish interface code and contract tests in Claude's main context before
launching implementation writers. When an independent implementation or review
pass would help, delegate that contract work to one native Claude subagent, then
review and integrate it in the main context. Do not use a GLM writer to design
or change an interface. Freeze the interface only after its contract checks
pass.

## Assign implementation ownership

Create one independently testable slice for each hidden implementation concern
that is ready to run. Give every active writer an exclusive write set. No two
writers may edit the same source file, test file, migration, generated contract,
snapshot, index, or shared artifact. Agents may read any repository file but may
write only their assigned paths.

There is no fixed worker cap. Launch every ready slice whose write set is
disjoint from active work, subject only to dependency order and actual provider
or machine capacity. Do not create filler slices or split work so finely that it
cannot be reviewed or tested independently.

Assign shared wiring and generated outputs to one owner. Dependent slices wait
until Claude accepts their prerequisite. A writer must not change a frozen
interface. If the interface is insufficient, it stops and reports the missing
capability, evidence, and smallest proposed contract change. Claude pauses the
affected work, revises the contract in the main context or through one native
Claude subagent, reviews and freezes it, and then resumes implementation.

## Prepare the fan-out

Create a temporary directory for prompts and logs only. Writers do not create
branches, copies, or worktrees.

```sh
run_root="$(mktemp -d /tmp/ticketry-glm-fanout.XXXXXX)"
```

Write each worker prompt to a separate file under `run_root`. Include:

- the slice goal, owning module, and exclusive allowed write paths;
- the frozen interface it must implement without changing;
- relevant `AGENTS.md`, `CLAUDE.md`, nested instructions, and architecture rules;
- acceptance checks and focused test commands;
- an instruction to implement and test the slice, not propose a plan;
- an instruction not to delegate, commit, push, publish, upload, or modify files
  outside the assigned write set;
- an instruction to stop if the interface is insufficient or an assigned file
  is being changed concurrently;
- a final report listing changed files, commands run, results, and blockers.

## Fan out GLM writers

Start every ready worker concurrently. The wrapper fixes the model to GLM 5.3
Flash, the reasoning variant to `high`, and the OpenCode agent to `build`. It
does not use OpenCode's dangerous `--auto` option.

```sh
${CLAUDE_SKILL_DIR}/scripts/run-glm.sh start \
  < "$run_root/writer-1.prompt" \
  > "$run_root/writer-1.events.jsonl" \
  2> "$run_root/writer-1.stderr.log" &
```

Track each process separately. Review whichever result finishes first. Keep
other independent writers running while one slice is under review.

## Review and correction loop

For each completed writer:

1. Extract its `ses_...` ID from the `sessionID` field in its JSONL events. Do
   not use `--continue`; concurrent sessions make the last session ambiguous.
2. Use the events and `git diff -- <owned-paths>` to inspect every attributed
   change. Check `git diff --check`, interface compliance, hidden implementation
   details, and preservation of pre-existing edits. The worker summary is not
   sufficient evidence.
3. Run the focused checks independently in the shared checkout. Avoid concurrent
   commands that write the same generated or build outputs.
4. Send concrete findings to the same session when correction is needed:

   ```sh
   ${CLAUDE_SKILL_DIR}/scripts/run-glm.sh resume \
     "<session-id>" \
     < "$run_root/writer-1.feedback" \
     > "$run_root/writer-1.correction.jsonl" \
     2> "$run_root/writer-1.correction.log"
   ```

5. Review and test the correction. Allow up to three correction rounds, then
   shrink or restate the slice once. Report a concrete blocker if it still
   fails. Do not silently take over implementation.
6. If a writer changes an unowned path or writers collide, stop the affected
   writers. Do not automatically revert files when ownership is ambiguous or
   pre-existing edits are present. Use event logs and diff evidence to plan a
   safe correction.

Refill the active pool whenever another ready slice has a write set disjoint
from all active work. Do not wait for an arbitrary batch boundary.

## Integration gates

Each accepted change already lives in the shared checkout, so there is no patch
application or cherry-pick phase. Claude reviews combined changes across module
boundaries and runs the smallest meaningful integration checks. Launch dependent
implementation only after its interfaces and prerequisites pass.

At the end, review the cumulative diff against the interface map and run the
repository's full required verification. Route hidden-implementation corrections
back to the relevant GLM session with a narrow write set. Keep interface
corrections in Claude's main context or one native Claude subagent. Do not fix
delegated implementation failures directly.

For Ticketry UI behavior changes, require matching
`studio/src/test/*Acceptance.test.tsx` coverage and run
`npm run test:overhaul --workspace @worktracker/studio` before handoff.

## Handoff

Report the frozen interfaces, whether their contracts were written in context or
through a native Claude subagent, implementation ownership, OpenCode session
IDs, reviewed files, verification commands and results, pre-existing changes
left untouched, and any remaining blocker. Report the temporary log directory
when it contains failure evidence.

Never use `opencode --auto`, `git reset`, `git checkout --`, or destructive
cleanup. Do not stage, commit, push, or publish unless the user explicitly asks.
