# Ticketry frontend performance profiling

A repeatable local profiling command. It drives Ticketry against synthetic
data, reproduces slow interactions and sustained idle work, and saves evidence
about where JavaScript time and retained memory go.

It is a measurement harness, not a benchmark suite and not a gate. It applies
no pass/fail threshold, it never runs in CI, and finding a cause is a separate
piece of work from finding a number.

## Commands

Run from the repository root.

```sh
# Build everything a run measures. A run never builds.
npm run perf:prepare

# Low-overhead timing runs
npm run perf:run -- --engine chromium --scenario idle
npm run perf:run -- --engine webkit   --scenario module-picker

# Diagnostic modes (they perturb the timings in the same run, by design)
npm run perf:run -- --engine chromium --scenario module-picker --capture cpu
npm run perf:run -- --engine chromium --scenario retention --capture heap-snapshot

# The real macOS WKWebView, through the test-only embedded WebDriver
npm run perf:desktop -- --scenario idle

# Changes: open the workspace, switch checkout, and select a changed file.
# This seeds a dirty module checkout and one indexed task worktree, records one
# fresh-app observation, then records five repeated interactions per path.
npm run perf:desktop -- --scenario changes-loading

# Compare two completed runs
npm run perf:compare -- --baseline <run-dir> --candidate <run-dir>

# Prove the collectors detect causes that are already known
npm run perf:verify

# Unit tests for the summarization, comparison, option and lock logic
npm run perf:test
```

`perf:prepare` also installs the Chromium and WebKit builds Playwright needs,
so a WebKit run cannot fail halfway through for want of a download.

`--dataset large` switches from 5 modules × 20 work items to 25 × 80.
`--adapter-profile release` builds and measures a release Rust adapter instead
of a debug one; the choice is recorded and runs across the two are refused as
incomparable.

`--frontend-port`, `--adapter-port` and `--mcp-port` name a port explicitly. A
named port that is occupied fails the run; it is never reused, because a run
that attached to somebody else's development server would be measuring the
wrong build. Without them a run takes its dedicated ports (4273, 8890, 8223) or
the next free port after each.

## What a run does, in order

1. **Refuses a stale build.** `perf:run` compares the working tree's frontend
   fingerprint against the one `perf:prepare` recorded and stops if they
   differ. `--allow-stale-build` proceeds and stamps the report accordingly.
2. **Takes the checkout's run lock**, so two runs cannot share the ports, the
   bundle, or the machine whose CPU they are measuring.
3. **Opens an isolated runtime**: a fresh temporary SQLite profile, a private
   tmux server, dedicated ports, the already-built Rust adapter, and `vite
   preview` serving `dist-performance` through the app's own proxy table. The
   live Ticketry database is never read, copied, seeded, or written.
4. **Seeds** through the same generated public GraphQL operations the app uses,
   outside every measured window, then re-reads the workspace and records what
   the app's own queries actually return.
5. **Runs the scenarios** serially, one worker, no retries.
6. **Writes artifacts** under `studio/test-results/performance/<run-id>/` and
   stops only the processes it started.

Ctrl-C at any point leaves no owned app, adapter, preview server or tmux
server behind.

## Artifacts

```text
studio/test-results/performance/<run-id>/
  metadata.json        schema, timestamp, git SHA + dirty flag, fingerprint,
                       dataset, engine, machine, ports, profiler settings
  fixture.json         what was actually seeded, and its seed duration
  summary.json         per-scenario summaries, raw samples included
  summary.md           the readable report
  manifest.json        every scenario mapped to every artifact it produced
  host-load.json       load and memory samples taken during the run
  playwright-report.json
  scenarios/<engine>/<scenario>/
    observations.json  raw timings, probe snapshot, operation counts, failures
    cpu.cpuprofile     --capture cpu; import in Chrome DevTools
    cpu-summary.json   top functions by sampled self time, plus attributed
                       time per script origin
    before/after.heapsnapshot   --capture heap-snapshot
```

The whole tree is already git-ignored, as is `studio/dist-performance`.

## Scenarios

| Scenario | What it does |
| --- | --- |
| `idle` | Opens a populated module, settles, records 15 s without input |
| `module-picker` | Open, type a known search, assert the filtered row, clear, close — 3 warmups then 20 repetitions |
| `module-navigation` | Alternates between two populated modules 20 times |
| `work-item-details` | Opens 20 known rows and verifies each selection |
| `retention` | 5 batches of 20 open/close/switch cycles over a fixed working set |
| `changes-loading` | Desktop only: opens Changes, switches from the module checkout to a task worktree, and selects a 64 KiB changed file; records first feedback and useful content separately |

The Changes fixture has no pull-request URL, so it makes no GitHub request. Its
report records the repository path, file size, worktree count, cache conditions,
and raw samples. Desktop GraphQL uses Tauri IPC, so this scenario cannot split
resolver time into repository-lock, Git, and provider stages without additional
backend timing points. Treat that split as unknown rather than inferring it from
the end-to-end number.

## What the numbers mean, and what they do not

Reading these reports correctly matters more than collecting them.

- **Interaction timings are end-to-end automation latency**: runner action
  dispatch to asserted-ready, on Node's monotonic clock. They include
  Playwright or WebDriver dispatch and assertion overhead. They are not INP and
  not paint latency.
- **Event Timing entries are not INP.** They are entries above a duration
  threshold, nothing more.
- **Unsupported metrics are null with a reason**, never zero. WebKit has no
  `longtask` observer and no `performance.memory`; a report says so rather than
  reporting no long tasks.
- **Scheduling delay** is the lateness of a 100 ms timer sampled in the page —
  an event-loop occupancy proxy, not a scheduler guarantee.
- **CPU frames are self time**, computed from `samples` and `timeDeltas`.
  Inclusive time is never reported as self time, and a frame without a script
  URL stays labelled unresolved.
- **CDP `Performance` metrics are renderer metrics**, not machine CPU percent.
- **The CPU profile is shared with the automation driver.** Playwright resolves
  its selectors inside the same renderer, so a profile of an interaction
  scenario contains its role-matching work alongside the application's. Read
  the per-origin attribution table first: it says how much of the profile is
  the application at all, and the resolved-frame table lists only the frames
  that can be traced back to source through the build's source maps.
- **Profile frames carry the optimized bundle's names.** The build emits source
  maps beside its assets, and DevTools applies them when the bundle is served
  at the origin the profile names. Bring the same bundle back up before
  importing a saved profile:

  ```sh
  npx --prefix studio -- vite preview --config vite.performance.config.ts --port 4273
  ```
- **Heap growth is a lead, not a leak.** Cache warmup grows a heap too; only
  continued growth across settled batches after the warmup batch distinguishes
  them. Chromium JS heap bytes and macOS physical footprint are two separate
  measurements and are never added together.
- **Subscription request counts are stream counts**, not event counts. The
  subscription route is one long-lived streaming POST.
- **p95 over 20 samples is approximate.** Every timing row carries its sample
  count and quantile convention (nearest rank, `ceil(p·n) − 1`), and rows with
  fewer than 40 samples are flagged.
- **Diagnostic captures perturb the run they are in.** A run with `--capture
  cpu` is not a baseline timing run, and its report says so.

## Engine coverage

| Surface | How | Limits |
| --- | --- | --- |
| Chromium | Playwright + CDP | Full CPU and heap capture |
| Playwright WebKit | Playwright | No CDP, so no CPU or heap capture. Not the installed macOS WKWebView |
| macOS WKWebView | `perf:desktop`, embedded test-only WebDriver | UI delay, renderer counters and available process metrics only |

`perf:desktop` reports no JavaScript CPU or heap recording, because no
supported interface for it is available from the harness. Record that by hand:
open Safari's **Develop** menu, choose the Ticketry process, open **Timelines**,
select **JavaScript & Events**, record, replay the same scenario, and export the
recording. A Chromium profile does not identify the hot function inside WebKit
and must never be cited as if it did.

Process attribution has the same honesty rule. A WKWebView content process is
owned by launchd rather than by the application, so it is attributed only when
exactly one new one appeared during the run; otherwise the metric is reported
unavailable rather than guessed at from the busiest WebKit process on the
machine.

## WebContent memory captures

`perf:desktop` measures the window's *timings*. It says nothing about what the
WKWebView content process **holds**, and the packaged retention sampler
(`measure:native-ghostty-retention`) deliberately reports the GUI process alone
because a retained-view budget is about AppKit views. `perf:webcontent` fills
that gap: it samples the `com.apple.WebKit.WebContent` XPC service that renders
the frontend.

```bash
# Which content process belongs to a running packaged window?
npm run perf:webcontent --workspace @worktracker/studio -- attribute \
  --executable /Applications/Ticketry.app/Contents/MacOS/ticketry

# Sample a running window for three minutes, with a mid-capture stackshot.
npm run perf:webcontent --workspace @worktracker/studio -- capture \
  --executable /Applications/Ticketry.app/Contents/MacOS/ticketry \
  --gui-pid 66450 --scenario packaged-live-workspace \
  --workload "..." --seconds 180 --interval-ms 2000 --settle-seconds 30 \
  --visible-viewers 0 --retained-viewers 0 --active-runs 0 \
  --stacks --output captures/live.json

# Launch a throwaway isolated instance and capture it (control condition).
npm run perf:webcontent:packaged --workspace @worktracker/studio -- \
  --output-dir captures --seconds 180

npm run perf:webcontent --workspace @worktracker/studio -- report -- captures/*.json
npm run perf:webcontent --workspace @worktracker/studio -- compare \
  --baseline captures/a.json --candidate captures/b.json
```

**Attribution is the hard part.** macOS gives no user-space link between an
application and the content process rendering its WebView: launchd is the
parent, `ps` shows no arguments, and the responsible-process link needs root. A
developer machine routinely runs a dozen content processes, several of them
large — this host had one at 1953 MB belonging to another application entirely.
So the capture attributes a content process only when exactly one started inside
the GUI process's launch window, and refuses with a reason when several did.
`--webcontent-pid` overrides the rule and is recorded as `operator-asserted`, so
no reader mistakes an assertion for a measurement.

**What the numbers are, and are not.** `footprint` splits the process into
allocator categories. A large `reclaimable` figure is pages WebKit's allocator
has freed but not yet returned to the OS — the system reclaims them under
pressure, so the headline footprint overstates live data. Subtracting
reclaimable from dirty does **not** yield a live JavaScript heap size; it is
arithmetic on allocator bookkeeping, and `summarize.mjs` carries that
correction as `impliedLiveIsNotAMeasurement`. Sustained growth (`retention`) and
oscillation (`churn`) are reported as separate findings, and retention is
refused outright when the content process restarted mid-capture, because first
and last samples would then belong to different processes.

The release artifact exposes no WebDriver endpoint, so the isolated launcher
cannot drive the window; it establishes readiness by waiting for the content
process instead, and cannot create run viewers. Viewer-count scenarios need a
build with the test-only WebDriver enabled.

## Before you trust a number

1. `npm run perf:verify` — the CPU collector must name a deliberately busy
   function, and the memory collector must see deliberately retained growth.
   These are collector checks. They say nothing about Ticketry.
2. Three independent runs on the same idle host, to establish local variance.
   `perf:compare` gives you the run-over-run medians; a delta smaller than your
   measured variance is not a finding.
3. Nothing else building or testing on the machine. The run records host load
   and labels a noisy report, but it never stops anyone else's work.

## Adding a scenario

Add the spec under `scenarios/`, register it in
`scripts/performance/options.mjs`, and name it with
`test.use({ scenarioName })` so its artifacts land in a directory the manifest
can point at. Shared fixtures and probe helpers live in `fixtures/scenario.ts`.

Only add instrumentation to the application when an injected browser probe
genuinely cannot measure the boundary. Cross-feature measurement plumbing
belongs in `src/shared/performance/`, domain counters belong in their feature,
and diagnostics may retain bounded counters — never a second snapshot of
application state.
