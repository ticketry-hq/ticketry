---
name: glm
description: "Implement code changes through 2-4 parallel GLM writers working on small, disjoint slices that the main agent reviews and verifies. Use only when the user explicitly invokes $glm."
---

# GLM iterative coding

Use GLM as the code writer and keep the main agent responsible for scope,
review, testing, and the final result.

GLM workers run as separate Codex CLI sessions through the `glm_worker`
profile. They are not built-in collaboration children because those children
inherit the OpenAI parent's provider in this Codex version. The profile keeps
the parent on OpenAI and routes only worker processes through OpenCodex.

## Working contract

- Write each worker assignment to a temporary prompt file, then launch it with
  `.codex/skills/glm/scripts/run-worker --prompt-file <path>`. The runner locks
  the worker to the `glm_worker` profile and the workspace-write sandbox.
- Run the launcher with approval for loopback access. The worker keeps Codex's
  normal approval policy, so actions outside the workspace remain gated.
- Maintain 2-4 active implementation workers when the task has that many
  independent slices. Use fewer workers when dependencies or shared files make
  safe parallelism impossible. Do not invent low-value work to fill the pool.
- Give every active writer an exclusive write set. Two writers must not edit the
  same file, migration, generated contract, snapshot, or shared artifact. Merge
  overlapping slices under one writer or run them sequentially.
- GLM writes the production code and tests. The main agent may inspect files,
  review diffs, run commands, and make integration decisions, but must not redo
  a delegated slice itself.
- Follow the repository's `AGENTS.md`, governing code structure, and any other
  skill triggered by the requested change. Include the relevant constraints in
  each worker handoff.
- Preserve the user's authorization boundaries. Invocation of this skill
  authorizes subagent delegation, not unrelated changes or external actions.

## Slice the work

Before spawning GLM, inspect enough of the repository to map dependencies and
define 2-4 ready slices with disjoint write sets. Each slice should:

- implement one behavior or one focused internal concern;
- have a narrow write set, usually a few named files;
- include its matching tests when the behavior can be tested in that slice;
- avoid unrelated cleanup and speculative refactors;
- end with a focused validation command or an explicit review condition.

Do not hand off the whole feature when it can be split into independently
reviewable changes. Do not split so finely that a slice cannot compile or be
meaningfully checked.

Assign one worker to shared integration files when needed. Any slice that
depends on that worker's output waits until the main agent accepts the
prerequisite.

## Handoff loop

Run the work as a bounded pool:

1. Give each GLM writer a concrete goal, exclusive write paths, repository
   constraints, acceptance checks, and focused test commands. Tell it to edit
   files directly in the shared workspace and report changed paths and test
   results. Tell it other workers may be active and it must stay within its
   exclusive write set.
2. Launch 2-4 ready writers in the same round when the execution tool supports
   parallel calls. Track each process separately. Continue useful read-only
   analysis while they work, then collect whichever result is ready first.
3. Review each uploaded diff as it arrives. Check correctness, ownership scope,
   repository structure, error handling, test quality, and accidental changes.
4. Run that slice's focused checks independently. Do not accept GLM's reported
   test result as the only evidence.
5. If a slice fails review, launch a correction worker with the original scope,
   current file state, and precise findings. Include file and line evidence when
   possible, then review and test the correction. Other independent writers may
   continue. Do not patch the findings yourself.
6. Accept a slice only when its diff and checks pass. Close that agent and refill
   the pool with the next ready slice whose write set is disjoint from all
   active writers. Do not start dependent work before its prerequisites pass.
7. After each parallel batch, inspect the combined diff and run the smallest
   useful integration check before launching work that builds on the batch.

Normally allow up to three correction rounds for one slice. If the same issue
persists, shrink or restate the slice once. If GLM still cannot complete it,
report the concrete blocker instead of silently taking over the implementation.

## Final gate

After all slices pass, the main agent reviews the cumulative diff and runs the
full relevant test suite required by the repository. Resolve any final finding
through another small GLM handoff. Hand the work back only when the cumulative
change meets the user's request and repository gates, or when a concrete
blocker remains.
