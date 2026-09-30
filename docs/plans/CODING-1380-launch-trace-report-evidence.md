# CODING-1380 — One timed launch report from a development run, on claude

Parent: CODING-1372 (`CODING-1372-launch-trace-probes.md`).

## What was produced

The reader `report_launch_trace` reads the development log `desktop:dev`
writes and prints one ordered, timed report per launch. Run from anywhere
inside the worktree:

```bash
cd studio/src-tauri
cargo run -p ticketry-dev-tools --bin report_launch_trace -- --provider claude
cargo run -p ticketry-dev-tools --bin report_launch_trace -- --summary
cargo run -p ticketry-dev-tools --bin report_launch_trace -- --agent-run <id>
```

Filters: `--log PATH`, `--agent-run ID`, `--attempt ID`, `--provider SLUG`,
`--verdict completed|refused|incomplete`, `--limit N`, `--summary`.

## Live capture, claude, development harness

Development log: `.ticketry-dev/logs/ticketry.log` of this worktree, written by
a `desktop:dev` run on 2026-09-02. Both launches were driven through the
desktop application; the backend half wrote its records directly and the
frontend half through forwarded standard output, and the reader joined them on
the `launch-attempt-committed` pairing.

```text
launch attempt 89f5a3cd4f1c452ca8c4f5c25e1556a1 · agent run 55865779dfc101b317b05feaf9728c82 · provider claude · project 345113f3-2578-4285-aed7-b86eb7c4fd78
  2026-09-02T13:34:10.149+00:00      start  launch-requested
  2026-09-02T13:34:10.154+00:00      +5 ms  launch-authority-resolved
  2026-09-02T13:34:10.160+00:00      +6 ms  launch-transaction-committed
  2026-09-02T13:34:10.160+00:00      +0 ms  launch-attempt-committed
  2026-09-02T13:34:10.337+00:00    +177 ms  launch-directory-preflighted
  2026-09-02T13:34:10.330+00:00      -7 ms  launch-executable-resolved ×5
  2026-09-02T13:34:10.517+00:00    +187 ms  launch-provider-validated
  2026-09-02T13:34:10.517+00:00      +0 ms  launch-argv-materialised
  2026-09-02T13:34:10.863+00:00    +346 ms  terminal-runtime-spawned
  2026-09-02T13:34:10.863+00:00      +0 ms  prompt-delivered
  2026-09-02T13:34:10.160+00:00    -703 ms  wake-up-published
  2026-09-02T13:34:10.161+00:00      +1 ms  durable-event-reread ×12
  2026-09-02T13:34:10.161+00:00      +0 ms  graphql-frame-delivered ×12
  2026-09-02T13:34:10.161+00:00      +0 ms  graphql-frame-received ×40
  2026-09-02T13:35:52.690+00:00 +102529 ms  apollo-run-applied ×28
  2026-09-02T13:34:10.240+00:00 -102450 ms  apollo-event-applied ×12
  2026-09-02T13:34:10.246+00:00      +6 ms  workspace-render-committed
verdict: completed in 97 ms
end of life: person_stop_action at 2026-09-02T13:34:40.629+00:00
```

```text
launch attempt f0c5767295c6412cba2d49679ab63ee1 · agent run 930660746a1e75ec4f4f19c46d33c900 · provider claude · project 345113f325784285aed7b86eb7c4fd78
  2026-09-02T13:34:44.949+00:00      start  launch-requested
  2026-09-02T13:34:44.956+00:00      +7 ms  launch-transaction-committed
  2026-09-02T13:34:44.957+00:00      +1 ms  launch-attempt-committed
  2026-09-02T13:34:45.126+00:00    +169 ms  launch-directory-preflighted
  2026-09-02T13:34:45.119+00:00      -7 ms  launch-executable-resolved ×5
  2026-09-02T13:34:45.304+00:00    +185 ms  launch-provider-validated
  2026-09-02T13:34:45.304+00:00      +0 ms  launch-argv-materialised
  2026-09-02T13:34:45.652+00:00    +348 ms  terminal-runtime-spawned
  2026-09-02T13:34:45.652+00:00      +0 ms  prompt-delivered
  2026-09-02T13:34:44.956+00:00    -696 ms  wake-up-published
  2026-09-02T13:34:44.957+00:00      +1 ms  durable-event-reread ×353
  2026-09-02T13:34:44.957+00:00      +0 ms  graphql-frame-delivered ×382
  2026-09-02T13:34:44.958+00:00      +1 ms  graphql-frame-received ×288
  2026-09-02T13:35:52.689+00:00  +67731 ms  apollo-run-applied ×28
  2026-09-02T13:34:45.022+00:00  -67667 ms  apollo-event-applied ×260
  2026-09-02T13:34:49.604+00:00   +4582 ms  workspace-render-committed ×2
verdict: completed in 4655 ms
```

## The same report for codex

```text
launch attempt a0f279783b9c44f7a23e1f5c428f2c57 · agent run 4ec49ea234b2f961a230e3fd03aa56f1 · provider codex · project 345113f3-2578-4285-aed7-b86eb7c4fd78
  2026-09-02T13:53:30.271+00:00      start  launch-requested
  2026-09-02T13:53:30.277+00:00      +6 ms  launch-authority-resolved
  2026-09-02T13:53:30.282+00:00      +5 ms  launch-transaction-committed
  2026-09-02T13:53:30.282+00:00      +0 ms  launch-attempt-committed
  2026-09-02T13:53:30.466+00:00    +184 ms  launch-directory-preflighted
  2026-09-02T13:53:30.460+00:00      -6 ms  launch-executable-resolved ×5
  2026-09-02T13:53:30.650+00:00    +190 ms  launch-provider-validated
  2026-09-02T13:53:30.650+00:00      +0 ms  launch-argv-materialised
  2026-09-02T13:53:31.003+00:00    +353 ms  terminal-runtime-spawned
  2026-09-02T13:53:31.003+00:00      +0 ms  prompt-delivered
  2026-09-02T13:53:30.282+00:00    -721 ms  wake-up-published
  2026-09-02T13:53:30.283+00:00      +1 ms  durable-event-reread ×135
  2026-09-02T13:53:30.283+00:00      +0 ms  graphql-frame-delivered ×211
  2026-09-02T13:53:30.284+00:00      +1 ms  graphql-frame-received ×95
  2026-09-02T13:53:51.433+00:00  +21149 ms  apollo-run-applied ×2
  2026-09-02T13:53:30.347+00:00  -21086 ms  apollo-event-applied ×93
  2026-09-02T13:53:30.354+00:00      +7 ms  workspace-render-committed ×2
verdict: completed in 83 ms
```

Summary over the whole log:

```text
  claude: completed 2
  codex: completed 12
  unknown: completed 3, incomplete 1990
```

The `unknown` rows are pre-instrumentation launches: run-keyed visibility
records with no provider and no pre-commit stage. That lopsidedness is the gap
the parent Story named, now visible as a count.

## The launch made to fail at a chosen stage

No live launch in the log refused, so the refusal report is produced by the
acceptance test `studio/src-tauri/tests/launch_trace_report.rs`, which drives
the real probes into a real log, reads it back with the same reader, and
asserts the report names `launch-executable-resolved` as the last stage
reached with its structured reason, and reports none of the stages after it.
A refusal against a running desktop application was not captured.

## What the live reports show

- **Commit precedes execution.** The launch transaction commits about 6 ms
  after the request; directory preflight, executable resolution, argv
  materialisation, runtime spawn, and prompt delivery all follow it. A launch
  that "never comes up" is therefore expected to have a run row and a
  `completed` visibility half while its execution half stops short.
- **Executable resolution runs five times per launch**, about 160–190 ms each
  (tmux three times, the provider twice), in series: about 810 ms of discovery
  in total against a 714 ms request-to-prompt path, the last two discoveries
  landing after prompt delivery. No budget is asserted here; the count and
  durations are the finding.
- **Path order is not always wall order.** Discovery is observed 6–7 ms before
  the directory preflight, so its elapsed time is negative. The reader keeps
  path order and signs the value rather than hiding it.
- **The visibility stages recur** for the run's whole life (hundreds of
  rereads and frames). The reader reports each stage at its first reach and
  appends the recurrence count, so the launch's own timing is what is read.
- **End of life is attributed.** The first claude run ends with
  `person_stop_action`; the second has no end record in this log.
- The second claude launch recorded no `launch-authority-resolved` stage and
  no launch surface; it is reported as reached-and-completed regardless.

## Reader defects found by the live data and fixed here

1. **One launch read as two reports.** The launch-discovery commit record
   predates the trace and writes the launch request identity under
   `launchAttemptId`. It is logged before the join record, and the reader let
   it claim the run, orphaning every pre-commit and execution stage on a
   second report. The reader now trusts `launch-attempt-committed` pairings
   first. No probe was changed.
2. **Recurring stages swamped the path.** Each recurrence was a stage, so
   "completed in" measured the run's lifetime. First reach plus a count.
3. `+-7 ms` rendered for negative elapsed. Signed now.

Absolute latency thresholds are not asserted anywhere. The launch path itself
is untouched; the CODING-1358 duplicate wake-up channel remains uncorrected.
