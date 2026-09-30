---
name: codex
description: Fan out an implementation across 2-4 isolated Codex CLI writers, then review, integrate, and verify every patch. Use only when the user explicitly invokes /codex.
argument-hint: <task, ticket, or spec path>
disable-model-invocation: true
user-invocable: true
compatibility: Requires an authenticated Codex CLI and git worktree support.
---

# Codex fan-out

Use Codex CLI workers to write the code. Claude owns decomposition, review,
integration, verification, and the final answer. While this skill is active,
Claude must not implement or repair delegated code itself.

## Task

$ARGUMENTS

If the task is unclear from the arguments and conversation, ask only for the
missing scope that changes implementation.

## Guard the working tree

1. Run `${CLAUDE_SKILL_DIR}/scripts/run-codex.sh check` and record
   `git status --short` plus `git rev-parse HEAD`.
2. Never stash, reset, discard, stage, or commit pre-existing changes in the
   main checkout.
3. Codex worktrees start from `HEAD`, so they do not contain uncommitted main
   checkout changes. If the task depends on or overlaps those changes, stop and
   ask the user how to checkpoint them. Unrelated dirty files may remain in the
   main checkout.

## Divide the work

Read the repository instructions and enough code to form 2-4 small,
independently testable slices. Give every active writer an exclusive write set.
No two writers may edit the same file, migration, generated contract, snapshot,
or shared artifact. Use fewer writers when the dependency graph does not allow
safe parallelism. Do not create filler work just to reach four workers.

Assign shared integration files to one slice. Dependent slices wait until Claude
accepts their prerequisite.

## Create isolated worktrees

Create one temporary run directory and detached worktrees from the recorded base
commit. Use explicit paths returned by `mktemp -d`; never target the repository
root or a home directory for cleanup.

```sh
run_root="$(mktemp -d /tmp/ticketry-codex-fanout.XXXXXX)"
base_commit="$(git rev-parse HEAD)"
git worktree add --detach "$run_root/writer-1" "$base_commit"
git worktree add --detach "$run_root/writer-2" "$base_commit"
git worktree add --detach "$run_root/integration" "$base_commit"
```

Create up to four writer worktrees as needed. Write each worker prompt to a file
under `run_root`. Each prompt must include:

- the complete slice goal and its exclusive allowed write paths;
- relevant `AGENTS.md`, `CLAUDE.md`, nested instructions, and architecture rules;
- acceptance checks and focused test commands;
- an instruction to implement and test the slice, not merely propose a plan;
- an instruction not to commit, push, publish, upload, or modify files outside
  the assigned write set;
- a final report listing changed files, commands run, results, and blockers.

## Fan out Codex writers

Start 2-4 workers concurrently. The wrapper uses `gpt-5.6-sol` with high
reasoning by default, a workspace-write sandbox, and automatic approval review.
It never bypasses the sandbox.

```sh
${CLAUDE_SKILL_DIR}/scripts/run-codex.sh start "$run_root/writer-1" \
  < "$run_root/writer-1.prompt" \
  > "$run_root/writer-1.events.jsonl" \
  2> "$run_root/writer-1.stderr.log" &
```

Launch all ready workers in the same round and track each process separately.
Review whichever result finishes first instead of waiting for the slowest
worker before starting review.

## Review and correction loop

For each completed worker:

1. Extract its session UUID from the `thread.started` JSONL event. Never use
   `resume --last` because concurrent sessions make it ambiguous.
2. Inspect `git status --short`, `git diff --check`, every changed file, and the
   complete diff. Reject changes outside the assigned write set.
3. Run the focused checks independently in that worktree. Codex's summary is not
   sufficient evidence.
4. Send concrete findings back to the same session when correction is needed:

   ```sh
   ${CLAUDE_SKILL_DIR}/scripts/run-codex.sh resume \
     "$run_root/writer-1" "<thread-uuid>" \
     < "$run_root/writer-1.feedback" \
     > "$run_root/writer-1.correction.jsonl" \
     2> "$run_root/writer-1.correction.log"
   ```

5. Review and test the correction. Allow up to three correction rounds, then
   shrink or restate the slice once. Report a concrete blocker if it still
   fails; do not silently take over implementation.
6. After acceptance, stage and commit the slice inside its temporary worktree.
   Record the commit hash. These commits are integration artifacts and must not
   move or commit the main checkout.

Keep other independent writers running while one slice is under review. Refill
the pool only with a ready slice whose write set is disjoint from active work.

## Integrate reviewed slices

Cherry-pick accepted worker commits into the temporary integration worktree in
dependency order. Review the combined diff and run the smallest meaningful
integration checks after each batch. If integration needs code changes, run a
new Codex session in the integration worktree, then apply the same review and
correction loop before committing its fix.

After all checks pass, generate one binary patch from the base commit, inspect
it, and apply it to the main checkout only after `git apply --check` succeeds.
Run the repository's full required verification in the main checkout. If a
failure occurs only because of pre-existing main-checkout changes, preserve the
evidence and report the conflict instead of rewriting the user's work.

For Ticketry UI behavior changes, require the matching
`studio/src/test/*Acceptance.test.tsx` coverage and run
`npm run test:overhaul --workspace @worktracker/studio` before handoff.

## Cleanup and handoff

Remove only the exact temporary worktrees created by this run, and only after
their accepted changes exist in the main checkout. Use `git worktree remove`
for each known path, then remove the empty run directory. If a run fails or
contains unintegrated work, keep the worktrees and report their paths for
recovery.

Report the slices, Codex session IDs, reviewed files, verification commands and
results, pre-existing changes left untouched, and any remaining blocker.

Never use `--dangerously-bypass-approvals-and-sandbox`, `danger-full-access`,
`git reset`, or destructive cleanup. Do not push or publish unless the user
explicitly asks.
