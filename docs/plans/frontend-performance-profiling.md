# Automated frontend performance profiling

Status: implemented. The profiling harness lives under `studio/performance/`
and `studio/scripts/performance/`, and is driven by `perf:prepare`, `perf:run`,
`perf:desktop`, `perf:compare` and `perf:verify`. Steps 1-6 are built and were
exercised on macOS: Chromium CPU and heap-snapshot captures, a Playwright WebKit
comparison run, and a desktop confirmation through the embedded WebDriver. No
application bottleneck was fixed, as this plan requires. See
[`../../studio/performance/README.md`](../../studio/performance/README.md) for
the commands, the artifact layout, and what each number does and does not mean.

Renderer note, added by CODING-1487: the `ghostty-wasm` renderer and its WASM
memory counters are gone. Desktop development and packaged builds render with
embedded native libghostty, browser development renders with xterm over the
`browserTerminalClient` WebSocket adapter, and xterm is the compatibility
fallback everywhere. The measurement seam moved to
`studio/src/features/agents/terminal/internal/rendererMeasurement.ts`. See
[`../archive/ghostty-wasm-restore.md`](../archive/ghostty-wasm-restore.md).

## Objective

Build a repeatable local profiling command that drives Ticketry, reproduces slow
interactions and sustained idle work, and saves evidence identifying expensive
JavaScript and retained memory. Another agent should implement the steps below
in order. Do not fix suspected application bottlenecks as part of this task.

The September 5 incident showed the installed webview at roughly 88–101% CPU,
a 2.9 GB peak physical footprint, and JavaScript occupying its main thread in a
native sample. Parallel Vitest workers and a Rust build also exhausted system
CPU and memory. Ticketry remained busy after those workers exited. These facts
motivate the scenarios; they do not establish a leak, a React loop, or a terminal
renderer defect.

## Decisions already made

- Use Playwright for automated browser journeys and Chromium CDP for CPU and
  heap captures. A Playwright trace is interaction evidence, not a CPU profile.
- Run the same browser journeys in Playwright WebKit for engine comparison.
  CDP is Chromium-only. Playwright WebKit is not the installed macOS WKWebView.
- Add a separate desktop confirmation command using the existing embedded
  WebDriver harness. Do not attempt to attach Playwright CDP to Tauri on macOS.
- Default to an optimized frontend build with source maps and an isolated real
  Rust adapter. Keep Vite development-server measurements explicitly separate.
- Start with local reports. No timing-based CI gate until repeatability and
  baseline variance have been measured.
- Run serially, with one worker and no automatic retries. Never start builds
  or other test suites during a timed scenario.
- Synthetic data only, in a new temporary database and private tmux server.
  Never copy, seed, or modify the live Ticketry database. No paid agents.
- Preserve the existing dirty worktree. Re-read relevant files before edits;
  several launch, terminal, state, and test files already have ongoing changes.

## Existing code to reuse

| File | Existing capability and implementation implication |
| --- | --- |
| `studio/playwright.config.ts` | One-worker browser suite, isolated server, dedicated ports. Add a separate performance config; do not inherit its entire acceptance setup. |
| `scripts/web-dev.mjs` | Temporary SQLite profile, readiness, ports, child lifecycle and cleanup. Extract small reusable lifecycle functions if necessary instead of cloning the launcher. It currently launches Vite dev, not an optimized preview. |
| `studio/scripts/desktop-dev.mjs` | Temporary profile and tmux ownership helpers already used by web development. Preserve their ownership and cleanup rules. |
| `studio/vite.config.ts`, `studio/vite.proxy.ts` | Existing frontend and GraphQL/SSE/document/terminal proxy configuration. Reuse the proxy table for the profiling preview. |
| `studio/e2e/support.ts` | Generated-operation GraphQL helpers, onboarding acknowledgement, project/module/work-item creation and accessible UI navigation. Reuse or extract narrowly; avoid duplicating generated operations. |
| `studio/e2e/web-app.spec.ts` | Examples of realistic fixture folders and UI journeys. Do not import its suite or trigger all its setup. |
| `studio/scripts/selection-browser-profile.mjs` | Existing Chromium microbenchmark. Keep it working, but it is not an app-wide profiling suite. |
| `studio/e2e-desktop/README.md`, `studio/scripts/desktop-agent-acceptance.mjs` | Actual WKWebView automation with test-only WebDriver and a deterministic disposable provider. Extract lifecycle reuse without rerunning the entire agent acceptance scenario. |
| `studio/src/features/agents/terminal/internal/rendererMeasurement.ts` | Existing `window.__ticketryRendererMeasurements()` snapshot: attach latency, frames, bytes and paint times. Capture before/after values; verify counter semantics before calculating deltas. |

Read AGENTS.md, CLAUDE.md and any applicable skills before implementation. If
public GraphQL contracts must change, apply the Seaography skill, but the
expected design needs no new endpoint, mutation, or Rust public export.

## Proposed files

Keep orchestration, browser probes and analysis separate. Names may be adjusted
to fit existing conventions; do not combine these into one large script.

```text
studio/playwright.performance.config.ts
studio/performance/scenarios/idle.spec.ts
studio/performance/scenarios/module-navigation.spec.ts
studio/performance/scenarios/workspace-retention.spec.ts
studio/performance/fixtures/seed.ts
studio/performance/fixtures/dataset.ts
studio/performance/collectors/browser-probes.ts
studio/performance/collectors/chromium-cpu.ts
studio/performance/collectors/chromium-memory.ts
studio/performance/collectors/request-counts.ts
studio/performance/report/schema.ts
studio/performance/report/summarize.ts
studio/performance/report/compare.ts
studio/scripts/performance/run.mjs
studio/scripts/performance/server.mjs
studio/scripts/performance/desktop.mjs
studio/performance/README.md
```

Only add app instrumentation when injected browser probes cannot measure the
required boundary. Cross-feature measurement plumbing belongs under
`studio/src/shared/performance/`; domain counters belong in their feature.
Diagnostics may retain bounded counters, never another snapshot of app state.

## Step 1: isolated optimized runtime

1. Add the separate Playwright config with Chromium and WebKit projects,
   `workers: 1`, no retries, fixed 1440×960 viewport and explicit timeouts.
   The performance directory must not be picked up by ordinary `test:e2e`.
2. Add a preparation phase that builds the Rust adapter and prepares Ghostty
   WASM, then builds the real frontend with source maps into an ignored,
   performance-specific output directory. Avoid overwriting `studio/dist`
   while another workflow owns it. Source maps must match the recorded bundle.
3. Start the already-built adapter against a fresh temporary profile and serve
   that frontend using Vite preview or an equally small existing static-server
   facility. Explicitly configure the shared proxy table, including SSE and
   WebSocket upgrades. Do not introduce a product backend or REST API.
4. Select dedicated free ports and pass the actual adapter origin to the
   preview configuration. Disable automatic browser opening. Fail on occupied
   requested ports instead of silently attaching to an existing service.
5. Wait for adapter and frontend readiness before seeding. Verify the profile
   ownership and record the run's actual database directory in local metadata.
6. On success, failure or interruption, terminate only owned children and the
   private tmux server; use existing cleanup/watchdog behavior. Copy diagnostic
   artifacts before deleting the temporary runtime directory.
7. Add a run lock to prevent overlapping profiling invocations in this checkout.
   Record host load and memory pressure where available. Warn and label noisy
   measurements; do not kill unrelated tests, builds or user processes.

Exit criteria: one command opens the optimized app against synthetic data;
Ctrl-C and intentional failure both leave no owned app, adapter or tmux process.

## Step 2: deterministic data and scenarios

Seed through existing generated public GraphQL operations outside measurement.
Use stable names and a recorded dataset version; use returned IDs instead of
assuming sequence numbers. Verify actual created counts, query pagination and
the visible rows used by scenarios. Do not disable pagination to inflate a test.

Start with two sizes: small = 5 modules × 20 work items; large = 25 modules ×
80 work items. Include a deterministic mix of states, a few parent/child groups,
and a fixed 20 KB description on selected items. Use bounded seeding concurrency
of at most four. Log seed duration separately. No real model discovery or launch
should be required to open the fixture. Reuse provisioned catalog entries.

| Scenario | Actions | Required evidence |
| --- | --- | --- |
| Idle workspace | Open populated module, settle, record 15 seconds without input | Script activity, event-loop delay, request counts and errors |
| Module picker | Open picker, type a known search, assert filtered item, clear and close; repeat 20 times after 3 warmups | Per-interaction timings, CPU profile in diagnostic mode |
| Module navigation | Alternate between two populated modules 20 times | Selection-to-ready timings, request counts, DOM growth |
| Work-item details | Open 20 known rows and verify the selected item and description | Timings and optional CPU capture |
| Retention | Repeatedly open/close picker and switch the same modules/items in 5 batches of 20 cycles | Heap/DOM samples after each settled batch; fixed working set |
| Desktop terminal activity | Disposable provider emits deterministic output at a bounded rate; compare visible, hidden and returned terminal states | UI delay, existing renderer counters, app/webview process samples |

Inspect `ModulePicker.tsx` and current acceptance cases for current accessible
names. Prefer roles, labels and existing test IDs, not CSS class selectors.
Never use `networkidle` as readiness for the app's persistent subscription.
Use the expected DOM state plus a bounded settling period. Idle windows are
intentional timed observations, not substitutes for readiness assertions.

Browser core scenarios must work without a terminal. Add the terminal scenario
only through the established disposable-provider/desktop fixture, not a real
Codex process. A later controlled status-update scenario may use existing public
mutations on fixture items at a fixed rate, with that workload recorded.

## Step 3: lightweight measurements

Install probes with `page.addInitScript` before navigation. Use a namespaced,
bounded diagnostics object with explicit start, snapshot and stop behavior.

- Measure runner action-to-asserted-ready duration using Node's monotonic clock.
  Label this end-to-end automation latency; it includes Playwright dispatch and
  assertion overhead and is not INP or exact paint latency.
- Capture supported `PerformanceObserver` entry types after feature detection.
  Unsupported long-task or event-timing metrics must be null with a reason,
  never reported as zero. Event Timing entries are not a complete INP result.
- Sample timer scheduling delay at a modest interval, e.g. 100 ms. Save a
  bounded distribution and maximum; do not poll the page from Node every frame.
- Optional two-animation-frame completion marks are render-opportunity proxies,
  not proof that the physical display painted. Keep this label in reports.
- Record DOM node count at batch boundaries, not on every interaction. Count
  page errors and GraphQL operations, separating setup from measured windows.
  Store operation names/counts and timing, not request or response bodies.
- For subscription activity over SSE, HTTP request count is not event count.
  Only add a bounded counter at the existing stream consumer if needed; do not
  monkey-patch fetch or duplicate the subscription to observe events.
- Read existing terminal measurement summaries only at scenario boundaries.
  Do not sum shared WASM buffers across surfaces without checking ownership.
- Remove listeners, observers and timers in finally blocks. Export once per
  window or batch; avoid serializing Apollo cache contents during measurement.

First deliverable: JSON and Markdown reports for idle and module-picker on
Chromium and WebKit, with explicit capability differences.

## Step 4: diagnostic CPU and memory modes

Keep these modes separate from low-overhead timing runs. Heap snapshots,
screenshots, tracing and CPU sampling perturb measurements.

### Chromium CPU

Use `page.context().newCDPSession(page)`, `Profiler.enable`, optionally
`Profiler.setSamplingInterval` before recording, then `Profiler.start` and
`Profiler.stop`. Save the returned profile as `cpu.cpuprofile` for Chrome
DevTools import. Start immediately before the defined workload and stop in a
finally block. Detach the CDP session even on failure.

Summarize top functions by sampled self time from `samples` and `timeDeltas`,
not merely hit counts. Keep script URL, line and column; retain the raw profile
and matching source maps even if automated source-map resolution is deferred.
Do not double-count inclusive time as self time. Unresolved frames stay labeled
unresolved. CDP Performance metrics may also provide cumulative task/script
duration deltas; label these renderer metrics, not total machine CPU percent.

### Chromium memory

Sample JS heap and DOM counters at batch boundaries. Provide an opt-in retained
heap experiment: warm the fixed working set, request garbage collection, take
baseline metrics, repeat cycles, settle, collect again and compare. Never force
GC inside timing runs. Increasing retained heap is a lead, not automatic proof
of a leak; distinguish cache warmup from continued batch-by-batch growth.

Provide opt-in before/after `.heapsnapshot` capture through HeapProfiler.
Stream snapshot chunks to disk with bounded buffering, do not concatenate huge
snapshots in Node memory. Handle stream completion, partial files, write errors,
timeout and listener cleanup. Large snapshots must not be captured by default.
Chromium JS heap bytes, WASM memory and macOS physical footprint are separate
measurements and must not be combined into a misleading total.

### Playwright trace

An explicit diagnostic option may also save `trace.zip` for selectors, console
errors and interaction context. Keep screenshots/video/traces off for baseline
timing. If a failure triggers a diagnostic rerun, label it as a separate run and
preserve the original failure; never replace the measured result with the rerun.

## Step 5: automated desktop confirmation

Build a test-only optimized desktop artifact with the existing
`desktop-acceptance` WebDriver feature and matching frontend source maps.
Do not install over `/Applications/Ticketry.app`, enable production WebDriver,
or reuse the live data directory. Separate build time from scenario time.

Extract the minimum existing desktop launch/connect/cleanup functions into
focused modules. Drive matching idle, picker and navigation actions through
WebdriverIO. Inject the same browser probe source via `browser.execute` after
page load, reinstalling after navigation. Capability-detect every metric.

Collect app CPU/RSS at a modest interval when OS permissions permit. Resolve
the actual webview process through available OS evidence; webview PPID may be
launchd, so do not assume it is a direct app child. If attribution is ambiguous,
report webview process metrics unavailable rather than using the busiest WebKit
process. Native `sample` captures are optional local diagnostics, not JS profiles.

The first desktop milestone automates UI delay, renderer counters and available
process measurements. Actual WKWebView JavaScript CPU/heap recording remains a
documented Web Inspector step unless a supported recording interface is proven.
Do not claim Chromium profiles identify the installed WebKit hot function.
Explain how to open Timelines, record the same scenario and export evidence.

## Step 6: artifacts, commands and comparison

Write generated files under already-ignored
`studio/test-results/performance/<run-id>/`. Keep the optimized build outside
the active Vite watch tree or explicitly ignore its directory. A manifest maps
each scenario/repetition to all its artifacts, including partial failures.

Required metadata: schema version, UTC timestamp, git SHA and dirty flag,
source/build fingerprint, dataset version/counts, engine/version, OS/architecture,
CPU model/count, RAM, Node/Playwright versions, headless/headed mode, viewport,
build mode, profiler settings, scenario parameters, warmups and sample counts.
Record host-load samples and unsupported metrics. Avoid full environment dumps.

Report raw observations plus median, p95 and max of each timing metric. State
the quantile convention and sample count. For 20 samples p95 is approximate;
do not imply statistical precision. Compare independent run medians as well as
within-run observations. Save failures and timed-out actions, not only successes.

Proposed workspace scripts, to implement and document:

```sh
# Repository root. Commands below do not exist yet.
npm run perf:prepare --workspace @worktracker/studio
npm run perf:run --workspace @worktracker/studio -- --engine chromium --scenario idle
npm run perf:run --workspace @worktracker/studio -- --engine chromium --scenario module-picker --capture cpu
npm run perf:run --workspace @worktracker/studio -- --engine webkit --scenario module-picker
npm run perf:run --workspace @worktracker/studio -- --engine chromium --scenario retention --capture heap
npm run perf:desktop --workspace @worktracker/studio -- --scenario idle
npm run perf:compare --workspace @worktracker/studio -- --baseline <run-dir> --candidate <run-dir>
```

`perf:run` must check prepared-artifact provenance and fail with the preparation
command if stale. Do not silently profile an old build. Implement a fast small
dataset default; make large datasets and heap snapshots explicit options.

Comparison rejects incompatible engine, machine class, build mode, dataset,
scenario parameters or instrumentation modes unless explicitly requested as an
informational comparison. Begin with three independent local runs to establish
variance. Do not invent a universal 100 ms or fixed MB pass threshold. A later
baseline policy should require both relative and absolute regression limits.
Only deterministic errors, missing required artifacts and harness failures
should fail the initial command. Keep CI performance thresholds out of scope.

## Verification and handoff

1. Test percentile/profile summarization using small known fixtures, including
   missing samples, null capabilities and partial failures.
2. Exercise a deliberately failing browser action and verify artifacts and
   owned-process cleanup. Exercise stale-build and occupied-port refusal.
3. Validate profiling against a tiny synthetic busy-loop page and a deliberately
   retained-allocation page. Confirm CPU/heap captures detect those known causes
   before interpreting Ticketry. These are collector checks, not app benchmarks.
4. Run the small idle/picker suite in Chromium and WebKit. Import one saved CPU
   profile and heap snapshot in DevTools to confirm the files are usable.
5. Run three low-overhead repetitions on the same host with no concurrent build;
   summarize observed variance and one supported conclusion about Ticketry.
6. Run the isolated desktop idle/picker scenario on macOS and report which
   metrics were available. Do not silently skip desktop confirmation.
7. Run relevant launcher tests and typecheck. If any user-visible Studio behavior
   changes, add/update a numbered `studio/src/test/*Acceptance.test.tsx` case,
   update the overhaul gate and run `npm run test:overhaul --workspace
   @worktracker/studio`. Profiling alone should need no visible UI changes.
8. Ensure generated databases, snapshots, source maps and reports are ignored.
   Hand off changed files, exact commands, artifact locations, capability limits
   and measured findings. Record blockers honestly; do not label an unexecuted
   engine or desktop scenario validated.

Implement steps 1–3 first, then CPU capture, memory capture, desktop confirmation
and comparison. Each stage should remain runnable. Avoid adding a dashboard,
new state store, new backend endpoint, generalized benchmark framework or
application performance fixes before usable captures exist.

## Primary references

- [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession)
- [Playwright BrowserContext, CDP and init scripts](https://playwright.dev/docs/api/class-browsercontext)
- [Playwright browser engine differences](https://playwright.dev/docs/browsers)
- [Chrome CPU profiler protocol](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/)
- [Chrome heap profiler protocol](https://chromedevtools.github.io/devtools-protocol/v8/HeapProfiler/)
- [WebKit Timelines](https://webkit.org/web-inspector/timelines-tab/)
- [WebKit memory debugging](https://webkit.org/blog/6425/memory-debugging-with-web-inspector/)
- [Tauri debugging and development tools](https://v2.tauri.app/develop/debug/)

Use the protocol supported by the installed Playwright Chromium version;
tip-of-tree documentation may describe newer methods or parameters.
