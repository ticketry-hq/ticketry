# Terminal renderer strategy: WASM first, native fallback

Status: working direction as of 2026-09-01. This document records the order of
experiments and the conditions for choosing a renderer. It is not evidence that
either approach has passed.

## Decision

Try to make `ghostty-wasm` production quality first. Claude already performs
well enough in that renderer to show that WebAssembly and Canvas are not, by
themselves, disqualifying. The current navigation delay and Codex scrolling
behavior have narrower causes that can be tested separately.

If the WASM approach fails any hard gate in this document, stop tuning around
the failure and return to native libghostty. The native fallback will put
Ghostty behind a transparent WebView and solve input routing at the AppKit
boundary.

xterm remains the compatibility fallback in either approach. Changing the
renderer must never change the Agent Run, tmux session identity, or persisted
Terminal Session.

```text
WASM lifecycle and scrolling spike
              |
              v
      all hard gates pass? ------ yes -----> ship ghostty-wasm
              |
              no
              v
native WebView layering and input spike ----> ship native libghostty
```

Do not build both at once. Finish the WASM evidence first so one failed design
does not leave two half-finished terminal paths.

## Terms and ownership

These lifetimes must remain separate:

- **Terminal Session** is the durable mapping from an Agent Run to tmux. tmux
  owns process continuity and survives renderer loss.
- **Viewer attachment** is the transient connection that carries ordered
  output, input, resize, and scroll requests for one Terminal Session. Its
  expiring viewer lease is not the Terminal Session.
- **Terminal core** interprets VT bytes and owns the grid, cursor, modes, and
  scrollback. In the WASM approach this is one libghostty-vt terminal.
- **Renderer** turns terminal-core state into pixels. It is Canvas in the WASM
  approach and Ghostty's Metal renderer in the native approach.
- **Presentation host** is the currently visible Studio rectangle for a
  terminal. Moving between a task workspace, drawer, or panel changes the host,
  not the Terminal Session.
- **Retained terminal** has a live terminal core while its presentation host is
  hidden. Retention does not imply continuous painting.

The durable session, viewer attachment, terminal core, renderer, and host are
five different states. No implementation status should collapse them into one
"terminal ready" flag.

## Shared requirements

Both approaches must satisfy these rules:

1. tmux remains the durable session owner.
2. A run has at most one authoritative viewer attachment and viewer lease.
3. Hiding, moving, replacing, or crashing a renderer does not end the run.
4. A hidden terminal does not schedule animation frames or perform paint work.
5. Returning to a retained terminal does not request tmux to reconstruct the
   screen before showing pixels.
6. Modals, confirms, menus, dropdowns, tooltips, and drag previews can cover a
   terminal without hiding it first.
7. Input cannot leak through JavaScript UI into a terminal underneath it.
8. Claude, Codex, shells, and full-screen terminal programs receive correct
   keyboard, mouse, paste, terminal-reply, resize, and scrolling behavior.
9. Browser and desktop renderer changes do not create a second session model.
10. Renderer failure falls back without losing tmux history or changing the
    Terminal Session record.

## Approach A: retain `ghostty-wasm`

### Why this goes first

The renderer already lives inside the WebView, so every JavaScript overlay
works through ordinary CSS stacking. Claude's current behavior also proves
that this path can render a real agent workload quickly. We should first test
whether the bad cases come from our lifecycle and scrolling policies rather
than from the renderer location.

The known weaknesses are concrete:

- ordinary navigation suspends the viewer attachment;
- returning resumes or recreates that viewer and asks tmux to redraw;
- Codex appears to take the alternate-screen, no-mouse branch that delegates
  wheel gestures to tmux copy mode;
- hidden terminal cores currently live with their Canvas and transport inside
  one `surface.ts` lifetime;
- terminal replies, selection, mouse buttons and motion, hyperlinks, graphics,
  and font behavior are incomplete.

The first two points explain why retaining the Canvas did not fix navigation.
The terminal objects survived, but the source of current screen state did not
remain continuously attached.

### Target lifecycle

```text
tmux Terminal Session
        |
        v
persistent viewer attachment
        |
        v
one retained Ghostty terminal core per run
        |
        +------ hidden: parse output, do not paint
        |
        +------ visible: bind Canvas, fit if needed, paint retained state
```

Ordinary navigation must not call `TerminalClient.suspend()`. The viewer stays
attached and the hidden core continues to consume ordered output. Returning to
the run paints the core's current state before any new transport handshake.

The Canvas is presentation state. It may remain allocated for a warm terminal
or be rebound when a host changes. The core and viewer attachment must not be
owned by the React host element.

One run may appear in different Studio hosts, but it still has one core and one
viewer. Different runs may be visible at the same time, such as an agent
terminal and the terminal panel, so the registry must support several active
cores without sharing geometry or focus.

### Implementation slices

Split the current joined lifetime into focused modules rather than expanding
`internal/surface.ts`:

1. A run-keyed registry owns retained cores and their viewer attachments.
2. A Canvas binding owns only DOM input, geometry, and painting.
3. Visibility starts and stops painting without changing attachment state.
4. Eviction disposes the core and attachment together, but never the tmux
   Terminal Session.
5. Host movement transfers the Canvas binding without creating another viewer
   lease.

Start the spike on the main WebView thread because that is the smallest change
that proves the lifecycle. Measure it under hidden output. If retained cores
produce long tasks or hurt Studio interaction, move the registry and VT parsing
to one Web Worker. Do not introduce a worker before the measurements show it is
needed.

### Retention and resource policy

Do not choose a cache size by intuition. Measure packaged builds with 1, 5,
and 20 retained terminals in these states:

- idle and hidden;
- hidden while one agent emits normal output;
- hidden while several agents emit output;
- one visible terminal under sustained output;
- rapid navigation through retained terminals.

Record WASM memory, JavaScript heap, total process memory, CPU, long tasks,
paint count, viewer count, and viewer-lease count. Hidden terminals must record
zero paints.

Choose the warm retention limit only after this capture. If eviction is needed,
use this lifecycle:

```text
visible          -> retained and painting
recently hidden  -> retained, attached, not painting
evicted          -> core and viewer disposed, tmux session unchanged
```

An evicted terminal may have a cold viewer attach when reopened. That case must
be visibly distinct in measurements from warm navigation.

### Codex scrolling spike

The current policy has three branches:

```text
program requests mouse reports  -> send wheel reports to the program
primary screen                   -> scroll Ghostty's local history
alternate screen without mouse  -> scroll through tmux copy mode
```

Before changing the policy, trace each wheel gesture in Claude and Codex with:

- active screen;
- mouse tracking mode;
- selected branch;
- wheel delta and generated row or notch count;
- input-to-paint latency;
- tmux copy-mode entry and exit.

The trace must confirm whether Codex takes the third branch. Then compare the
same gesture with native Ghostty. Fix the identified branch, not Codex by name.
The rule must also work for `vim`, `less`, `htop`, and any other program with
the same terminal modes.

Scrolling passes only when:

- trackpad motion is smooth in both directions;
- scrolling down always reaches live output;
- output arriving while scrolled back does not move the content being read;
- entering or leaving the alternate screen cannot retain a stale viewport;
- a program requesting mouse reports receives them instead of host scrollback;
- the user can still inspect history when an alternate-screen program does not
  request mouse input;
- wheel handling does not create one tmux round trip per small pixel delta.

### Correctness work

The WASM renderer is not ready while the following remain missing:

- `WRITE_PTY` terminal replies for device and status queries;
- mouse buttons, motion, drag, and application mouse modes;
- selection rendering and copy across wrapped and wide cells;
- OSC 8 hyperlink hover and activation;
- keyboard modifiers, function keys, IME, bracketed paste, and large paste;
- combining marks, emoji families, wide characters, Arabic, Nerd Font, and
  Powerline rendering;
- full-screen application behavior and alternate-screen transitions;
- supported terminal graphics, including Kitty graphics where expected.

Each item needs a focused automated contract test where possible and a named
manual capture where WKWebView behavior cannot be asserted reliably in jsdom.
xterm fallback is not evidence that the default renderer is correct.

### WASM pass gates

The approach passes only when all of these hold in a packaged Ticketry build:

- Warm navigation shows the retained current frame without a blank interval,
  tmux replay, viewer attach, or viewer-lease churn.
- Claude and Codex scrolling match native Ghostty's direction, reachability,
  and perceived latency under the same dimensions and input device.
- Hidden output does not cause paints and does not make React interactions
  miss frames under the measured retention load.
- Returning to a terminal that produced hidden output shows its latest state,
  in order, without requesting a full tmux redraw.
- One run never owns more than one core, viewer attachment, or viewer lease as
  presentation moves between hosts.
- The correctness list above has no blocking gap.
- The comparison matrix in
  `CODING-1304-webview-ghostty-renderer-evidence.md` is filled with captures
  from the same machine and packaged build.

Stop the WASM approach if any of these proves impractical:

- persistent hidden cores make normal Studio interaction miss frames at a
  realistic terminal count;
- the viewer lease cannot remain attached without violating ownership;
- terminal replies cannot be wired safely in WKWebView JavaScriptCore;
- Codex scrolling still requires a slow or unreliable tmux interaction;
- selection, input, or font correctness requires replacing most of the Canvas
  renderer.

## Approach B: native libghostty behind a transparent WebView

This work starts only if the WASM approach fails a hard gate.

### Why keep it as the fallback

Native libghostty already provides the terminal behavior, font handling, input,
and Metal rendering we trust. Its problem is composition. Ticketry currently
adds `MuxedGhosttyView` as a child above the entire `WKWebView`, so CSS
`z-index` can never place a modal or dropdown above it.

The fallback changes the native hierarchy rather than changing terminal
emulation.

### Target composition

```text
JavaScript UI and overlays
transparent WKWebView
one or more native Ghostty views
window background
```

Ghostty becomes a sibling below the WebView, not a child above it. The WebView
and its native backing must preserve alpha. Studio must paint explicit
backgrounds everywhere except each terminal host rectangle. A translucent
scrim then blends over the live terminal naturally.

Nothing in JavaScript should ever need to know that a modal, menu, tooltip, or
drag preview overlaps a terminal. Ordinary DOM stacking must be sufficient.

### Input-routing spike

A transparent `WKWebView` still participates in AppKit hit testing. Visual
transparency does not prove that mouse events reach a sibling behind it. The
spike must test native routing before the application is restructured around
this design.

Preferred behavior:

1. AppKit hit testing identifies a visible terminal host rectangle.
2. If no JavaScript element occupies that point, AppKit targets the matching
   Ghostty view.
3. The first click focuses Ghostty and subsequent keyboard and IME events go
   directly to it.
4. If a dropdown, modal, tooltip, or drag target occupies the same point, the
   WebView receives the event and nothing reaches Ghostty.

The spike must cover click, double click, selection drag, mouse-report drag,
wheel and trackpad gestures, focus transfer, keyboard input, IME, and lost
focus while an overlay opens.

If permanent click-through cannot distinguish transparent terminal content
from a JavaScript overlay, test dynamic native ordering as the fallback. In
that version Ghostty sits above the WebView only while no overlapping
JavaScript UI is open. The WebView moves above every Ghostty view during an
overlay episode. This is less attractive because every occluding UI path must
participate in one reliable registry.

Do not forward all mouse movement through ordinary Tauri invokes as the first
solution. Selection and mouse-report dragging would put a high-frequency input
path through JavaScript IPC and would create another terminal behavior layer
that native Ghostty already implements.

### Multiple native Ghostty views

Several Ghostty views may exist below one WebView. Each visible terminal host
publishes its frame, visibility, and focus eligibility to the native root.
Non-overlapping visible views can render together. During React transitions,
the native side must reject stale frames and must never leave two views
eligible for the same host.

A native Ghostty view owns emulator state, a Metal layer, font and GPU
resources, and a tmux client process. Measure 1, 5, and 20 retained views before
choosing a warm limit. Hidden views must stop drawing. Evicting a view must
leave its tmux Terminal Session alive.

### Native pass gates

- The WebView is transparent only where a terminal is meant to appear. No
  accidental window holes appear during navigation, resize, or fullscreen.
- A translucent modal or scrim visibly covers a running terminal.
- Dropdowns, menus, tooltips, and drag previews can overlap the terminal and
  remain fully interactive.
- Pointer and keyboard input reach the intended terminal with no JavaScript
  overlay open.
- Input never leaks into a terminal beneath JavaScript UI.
- Two simultaneously visible terminals route focus, input, resize, and scroll
  independently.
- Hidden views perform no redraw work, and the measured warm-cache policy does
  not create unacceptable CPU, memory, or GPU use.
- Navigation, fullscreen, panel resize, drawer ownership, WebView reload, and
  renderer recovery preserve the Terminal Session.

## Evidence and deliverables

For the WASM attempt, produce:

1. Claude and Codex scrolling traces.
2. Warm-navigation traces proving no suspend, attach, or tmux redraw.
3. Resource captures for 1, 5, and 20 retained cores.
4. Correctness captures and automated tests for the blocking gaps.
5. A completed renderer comparison matrix and a written recommendation in
   `CODING-1304-webview-ghostty-renderer-evidence.md`.

If the native fallback is triggered, produce:

1. A minimal transparent-WebView and hit-testing prototype before changing the
   production hierarchy.
2. Pointer-routing captures with and without overlapping JavaScript UI.
3. Resource captures for retained native views.
4. Acceptance coverage for modal, dropdown, focus, multiple-terminal,
   navigation, resize, and recovery behavior.

The final renderer choice should become an ADR only after one approach passes.
At that point update `AGENTS.md`, the renderer README, and any default-selection
tests to match what actually ships.

## Existing evidence

- `docs/plans/CODING-1304-webview-ghostty-renderer-evidence.md` contains the
  original comparison matrix and known WASM gaps.
- `studio/src/features/agents/terminal/ghostty-wasm/README.md` describes the
  current implementation, including its present suspend and scrolling policy.
- `docs/research/t3-code-terminals.md` records earlier renderer research.
