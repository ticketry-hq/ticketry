# CODING-1490: WebView memory in the packaged desktop build

Investigation record. Every number here comes from a capture this document
names; where evidence is missing the document says so instead of estimating.

## What was asked

The packaged Ticketry window's WKWebView content process holds several hundred
MB and its footprint swings by hundreds of MB while the application looks idle.
The Story asked what causes that, whether it is retention or churn, and whether
it affects responsiveness. It explicitly did not authorise a fix.

## Method

`npm run perf:webcontent` (`studio/scripts/performance/webcontent-memory.mjs`)
samples the `com.apple.WebKit.WebContent` XPC service that renders the frontend.
It exists because neither existing tool answers this question: `perf:desktop`
measures timings, and `measure:native-ghostty-retention` deliberately samples
the GUI process alone, because a retained-view budget is about AppKit views.

### Attributing the right process

macOS exposes no user-space link between an application and the content process
rendering its WebView. launchd is the parent of every content process, `ps`
shows no arguments, and the responsible-process link needs root. This host was
running eleven content processes during the investigation, several of them
large. One unrelated process held 1953 MB. "The biggest WebKit process" would
have been a number that reads like evidence and is not.

The capture attributes a content process only when exactly one started inside
the GUI process's launch window, and refuses with a reason when several did.
`--webcontent-pid` overrides the rule and is recorded as `operator-asserted`.
Continuity is rechecked every tick: if the content process is replaced or the
window exits, the capture ends and records the break, because joining samples
across a restart produces a growth figure for a process that never grew.

### What is sampled

`footprint --json` for the allocator category breakdown, `ps` for RSS and CPU on
both the content process and the GUI process separately, and `sysctl`/`vm_stat`
for host swap and page state per sample. A footprint measured on a machine
already deep into swap is a different observation from the same figure on an
idle host. Sampling runs in a separate Node process and injects nothing into the
page. A `sample(1)` stackshot is taken mid-capture; it is disclosed in the
capture's `instrumentation` block because it briefly introspects the target.

## Provenance

| | |
| --- | --- |
| Artifact | `/Applications/Ticketry.app`, version 0.2.0, `buildMode: packaged` |
| Executable SHA-256 | `426234636c6341fbc3fd3d3bd54f838b58c6bdaa610c9a7b6f160213e2f0169a` |
| Machine | Mac14,9, arm64, 10 logical CPUs, 16 GiB RAM |
| OS | macOS 26.2 (build 25C56) |
| Date | 2026-09-05 |
| Raw captures | `packaged-live-workspace.json`, `packaged-isolated-empty-workspace.json`, plus their `.stacks.txt` stackshots |

The source tree was dirty throughout, and the installed artifact was built
earlier from a different working state. The capture records a source
fingerprint, but it describes the tree at capture time, **not** the tree the
installed binary was built from. Treat the SHA-256 as the artifact's identity;
do not treat the fingerprint as its source.

## Finding 1: the symptom reproduces, and it is churn rather than retained growth

Capture `packaged-live-workspace`: 79 samples over 179.1 s at 2 s, after a 30 s
settle, against a packaged window attached to the developer's live workspace
(`state.db`, 101 MB).

| Series | median | min | max | net change | range |
| --- | ---: | ---: | ---: | ---: | ---: |
| footprint | 469.7 MiB | 439.9 MiB | 813.0 MiB | **−19.3 MiB** | **373.1 MiB** |
| WebKit malloc dirty | 412.2 MiB | 385.9 MiB | 758.9 MiB | −19.8 MiB | 373.1 MiB |
| WebKit malloc reclaimable | 177.0 MiB | 6.1 MiB | 406.5 MiB | +10.0 MiB | 400.5 MiB |
| WebContent RSS | 623.7 MiB | 166.3 MiB | 836.8 MiB | −19.4 MiB | 670.6 MiB |
| WebContent CPU | 1.6% | 0.0% | 89.3% | — | — |
| GUI (Rust host) CPU | 58.5% | 10.0% | 115.6% | — | — |

The footprint ended 19.3 MiB **below** where it started while travelling 373 MiB,
and the largest swing inside any 20 s window was 370 MiB. Over this window the
process retained nothing; it allocated and released hundreds of MB repeatedly.
The Story read the original samples as churn rather than a static leak. That
reading holds for this window. It does not exclude slow retention over hours,
which this capture is too short to see.

The shape is a ~440 MiB floor with short excursions: two spikes to 813 MiB
(t=86 s) and 785 MiB (t=166 s), each resolving within about ten seconds, and
each coinciding with a WebContent CPU burst (11% and 89%).

## Finding 2: the swing is committed memory, not allocator bookkeeping

This corrects the original ticket. Across the 79 samples:

- correlation of footprint with **WebKit malloc dirty**: **r = 0.979**
- correlation of footprint with **WebKit malloc reclaimable**: **r = −0.266**

Dirty pages and reclaimable pages move independently. The footprint tracks
dirty almost exactly; reclaimable oscillates on its own between 6.1 MiB and
406.5 MiB. So the swing is genuinely committed and released memory, and the
ticket's "implied live = dirty − reclaimable" column is arithmetic over two
independently moving quantities, not a measurement of live JavaScript data. The
harness carries that correction as
`summarize.mjs`'s `impliedLiveIsNotAMeasurement`, and the two quantities are
reported as separate series that are never subtracted.

Two categories are ruled out as contributors. JIT code stayed flat at
6.8 to 7.2 MiB, so repeated compilation is not accumulating. Graphics backing stores moved
between 34.9 MiB and 109.3 MiB, an order of magnitude below the swing. Host swap
was pinned at 2070 MiB for the whole window and did not move with the footprint.

## Finding 3: all non-idle work in the content process was host-injected JavaScript

A `sample(1)` stackshot taken mid-capture, over 10 s:

| Main-thread samples | Where |
| ---: | --- |
| 908 | total |
| 871 | `mach_msg`, the run loop waiting. Idle. |
| **32** | `IPC::Connection::dispatchMessage` → `Messages::WebPage::RunJavaScriptInFrameInScriptWorld` → `ScriptController::evaluateInWorld` → `JSC::evaluate` → **`JSC::Interpreter::executeProgram`** |
| 5 | everything else |

`RunJavaScriptInFrameInScriptWorld` is what `WKWebView.evaluateJavaScript` becomes.
`executeProgram`, rather than a call into already-compiled code, means each
message arrives as fresh program source that must be parsed and compiled.
Of the 37 non-idle main-thread samples, 32 were this one path. A 20 s stackshot
taken separately against the same process showed the same stack at 74/1829.

The leaf frames name the work inside those programs:
`operationObjectKeys` → `JSC::ownPropertyKeys` → `getOwnIndexedPropertyNames`
→ `PropertyNameArray::add` → `JSC::Identifier::from` → `AtomStringImpl::addSlowCase`.
That is `Object.keys`/`Object.entries` over indexed objects, interning an atom
string per key. That allocates heavily.

The allocator side is visible on its own threads: the `JavaScriptCore libpas
scavenger` was running `pas_physical_page_sharing_pool_scavenge` → `decommit_all`
→ `madvise`, which is the machinery that returns freed WebKit-malloc pages to
the OS, and the JSC Heap Collector was marking (`SlotVisitor::drain`).

Independently, macOS had already recorded a `cpu_resource` exception against a
Ticketry WebContent process earlier the same day
(`/Library/Logs/DiagnosticReports/com.apple.WebKit.WebContent_2026-09-05-091348_*.cpu_resource.diag`):
**90 s of CPU over 180 s, a sustained 50% average**, with the identical heaviest
stack and a footprint of 660 MB → 720 MB peaking at 1257 MB. That is the same
mechanism at a much higher rate, recorded by the OS without any instrumentation
from this investigation.

## Finding 4: why every message is a fresh program

From the pinned dependency `tauri = "=2.11.5"`
(`studio/src-tauri/Cargo.toml:118`), read in the vendored crate source:

- `Channel::send` (`tauri-2.11.5/src/ipc/channel.rs:300-316`) emits
  one `webview.eval(...)` per message. Below
  `MAX_JSON_DIRECT_EXECUTE_THRESHOLD` (8192 bytes) the payload JSON is
  **inlined literally into the program source**, so the JavaScript parser, not
  `JSON.parse`, does the decoding. Above it, the message costs an eval *plus* a
  fetch round trip *plus* a second `runCallback`.
- `emit` (`tauri-2.11.5/src/event/mod.rs:194-206` via
  `webview/mod.rs:1974-1981`) is also one eval per event, generating
  `(function () { const fn = window['…']; fn && fn({event, payload}, ids) })()`.
- Both land on `wry-0.55.1/src/wkwebview/mod.rs:756`
  `evaluateJavaScript_completionHandler`, the WebKit entry point the stackshot
  shows.

There is **no message-port or `postMessage` path** for host→WebView data in this
version, and no batching or coalescing anywhere.

Ticketry has exactly two `Channel` users, and they are the only high-rate
host→WebView paths in the repository:

1. GraphQL subscription frames.
   `crates/foundation/tauri-graphql/src/api.rs:161`, one `send` per frame of the
   single `run_status_stream` subscription. On desktop, Apollo queries,
   mutations *and* subscriptions all ride this proxy
   (`studio/src/runtime/desktopRuntime.ts:247`,
   `studio/src/graphql-foundation/generated/taurpc.ts:16-24`).
2. xterm terminal output.
   `crates/execution/ticketry-terminal/src/terminal/viewer/webview_commands/worker.rs:243`,
   **one `send` per PTY read chunk**, with no coalescing
   (`while let Ok(event) = receiver.recv() { output.send(event) }`) and an 8 KiB
   read buffer. `ViewerChannelEvent::Output` serialises `Vec<u8>` as a JSON
   number array, so any chunk over roughly 2.5 KB crosses the 8192-byte
   threshold and takes the more expensive branch.

Ordinary `invoke` responses are *not* evals here: the app's CSP permits the
`ipc:` custom protocol, so command results return over `fetch`.

## Finding 5: the control. Same artifact, no traffic, no memory, no churn

Capture `packaged-isolated-empty-workspace`: the same executable, same machine,
same protocol (30 s settle, 79 samples over 178.1 s at 2 s), launched against a
throwaway data directory and a private tmux server. No project data, no agent
runs, no viewers, no document.

| Series | control median | control range | live median | live range |
| --- | ---: | ---: | ---: | ---: |
| footprint | **45.9 MiB** | **21.5 MiB** | 469.7 MiB | 373.1 MiB |
| WebKit malloc dirty | **17.6 MiB** | **0.9 MiB** | 412.2 MiB | 373.1 MiB |
| WebKit malloc reclaimable | 0.0 MiB | 0.8 MiB | 177.0 MiB | 400.5 MiB |
| WebContent CPU | **0.0%** | 1.1% | 1.6% | 89.3% |
| GUI (Rust host) CPU | **0.0%** | 0.5% | 58.5% | 105.6% |

The control's mid-capture stackshot: **918 of 918 main-thread samples in
`mach_msg2_trap`**, and **zero** `RunJavaScriptInFrameInScriptWorld`.

So the packaged shell, meaning the window, WebView, frontend bundle and
renderer, costs about 46 MiB of footprint with 17.6 MiB of WebKit malloc that does not move, and no
measurable CPU in either process. Everything the Story reports appears only when
the workspace and its event traffic are present. The comparison is compatible
under the harness's own rule: same executable SHA-256, machine class, build
mode, settle and sampling parameters.

## What this establishes

The WebContent memory and its oscillation are produced by **host→WebView message
delivery**, not by the shell, the renderer, or the WebView itself.

The chain, each link with its own evidence:

1. With no host→WebView traffic, the content process holds 17.6 MiB of WebKit
   malloc, flat, and runs no JavaScript at all (Finding 5).
2. With traffic, every non-idle main-thread sample bar five is
   `evaluateJavaScript` compiling and running a fresh program (Finding 3).
3. Tauri 2.11.5 delivers every subscription frame and every xterm output chunk
   as exactly one such program, with sub-8 KB payloads inlined as literal
   program source for the JS parser to decode (Finding 4).
4. The memory that moves is committed WebKit-malloc dirty pages, tracking the
   footprint at r = 0.979, and the allocator's scavenger was observed returning
   them with `madvise` (Findings 2 and 3).

That is a mechanism supported by a stack, a controlled comparison and the
delivery code, rather than a temporal correlation.

## What this does not establish

- **Which Channel dominates.** There are two: GraphQL subscription frames
  (one eval per frame) and xterm terminal output (one eval per PTY read chunk,
  uncoalesced). The second is by far the higher-rate path but is only live on
  the compatibility renderer, during native preparation, or when native attach
  fails. The sampled instance's renderer state was not verified, and its
  desktop file logging was off, so no `graphql-frame-delivered` counts exist for
  it. **This is the next experiment**, and it is cheap: count
  `graphql-frame-delivered` by `frameKind` over 60 idle seconds, then repeat with
  the renderer forced to xterm, in a build with file logging on.
- **The leaf.** `selectionEqual`
  (`studio/src/features/agents/status/hooks.ts:21-39`) recursively walks
  `Object.entries` for seven `useAgentStatusSelection` hooks on every frame,
  which fits the `operationObjectKeys` / `ownPropertyKeys` leaf. The JIT frames
  are unsymbolicated, so this remains a hypothesis. Symbolicating them, or a
  Web Inspector JavaScript timeline, would settle it.
- **Responsiveness.** Not measured. No interaction latency was captured, so
  nothing here says the memory behaviour is felt by the user, only that the
  content process's main thread is doing work in bursts up to 89% CPU. The
  packaged artifact exposes no WebDriver endpoint, so `perf:desktop` cannot
  drive it; measuring this needs a build with the test-only WebDriver enabled.
- **Regression attribution.** No artifact predating the native-renderer default
  was available, so nothing here says whether this behaviour is new. The WASM
  archive branch is a snapshot of a dirty tree, not a comparable build.
- **Slow retention.** Both captures are three minutes. A three-minute window
  showing −19.3 MiB net cannot exclude retention over hours.
- **Data volume versus message rate.** The control removed the workspace *and*
  the traffic together. Separating "large payloads" from "many messages" needs
  a populated workspace with the event stream quiesced.

## Reproducing

```bash
# Attribute and capture a running packaged window.
npm run perf:webcontent --workspace @worktracker/studio -- attribute \
  --executable /Applications/Ticketry.app/Contents/MacOS/ticketry
npm run perf:webcontent --workspace @worktracker/studio -- capture \
  --executable /Applications/Ticketry.app/Contents/MacOS/ticketry --gui-pid <pid> \
  --scenario packaged-live-workspace --workload "..." \
  --seconds 180 --interval-ms 2000 --settle-seconds 30 \
  --visible-viewers 0 --retained-viewers 0 --active-runs 0 \
  --stacks --output captures/live.json

# The control: a throwaway isolated instance of the same artifact.
npm run perf:webcontent:packaged --workspace @worktracker/studio -- \
  --output-dir captures --seconds 180

npm run perf:webcontent --workspace @worktracker/studio -- compare \
  --baseline captures/packaged-isolated-empty-workspace.json \
  --candidate captures/live.json
```

Nothing in this investigation modified the live database, terminated a run, or
changed a durable tmux identity. The control instance ran with its own
`MUXED_DATA_DIR` and `MUXED_TMUX_SOCKET` and was removed afterwards.

## No remediation is selected here

The Story authorised investigation, not a fix. The evidence points at the
host→WebView delivery path. The obvious directions each change user-visible
behaviour and belong in their own ticket with their own measurements: coalescing
subscription frames, chunking or batching terminal output, avoiding the sub-8 KB
inline-source branch, and reducing per-frame work in the status selectors. The harness added here is what makes such a change measurable:
capture before, capture after, and `compare` refuses to subtract two captures
that are not the same experiment.
