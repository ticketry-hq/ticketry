# CODIN-749 — LLD: single-owner terminal foreground registry

Slice 3 of CODIN-703 (Tabbed ticket drawer). Frontend-only. Blocked-by
CODIN-748 (seam present in tree); blocks CODIN-751 (drawer Terminal tabs).

## 1. Objective and boundary

Deliver the state and mechanism that guarantee **one foreground xterm DOM owner
per live terminal session** once both `/coding` and the issue drawer can present
the same `terminalStore` session. This slice ships:

- a per-session foreground **ownership registry** (policy: who may present a
  session);
- a shared, non-React **terminal entry pool** (mechanism: one `Terminal` + one
  WebSocket per session, structurally un-duplicable);
- a refactor of `TerminalHost` from *pool owner* to *registry-gated view* that
  borrows entries from the pool and backs off when the drawer owns a session;
- the smallest **adapter API** (claim / release / host registration) that
  CODIN-751 will call to add the drawer host;
- focused tests for arbitration, release, no-duplicate-xterm/WS, scrollback /
  identity preservation, and `/coding` fallback.

Explicitly **not** in this slice: any drawer terminal component, drawer tab
strip, run-history chips, launch/attach controls, doc tabs, doc-chat overlay
changes, `/coding` navigation changes, and any backend / wire-frame change.

## 2. Why the registry alone is insufficient (design rationale)

Ownership arbitration only decides *which surface is visible*. If `/coding` and
the drawer each kept their own component-local entry map (as `TerminalHost` does
today via `entriesRef`), an ownership transfer would make the new owner spawn a
**second** `Terminal` and a **second** WebSocket viewer for the same live run —
violating the "no duplicate xterm / WS viewer" acceptance criterion. Therefore
single-owner requires two cooperating pieces:

- **One shared entry pool** so the `Terminal`/WS objects exist exactly once per
  session, independent of how many surfaces reference them; and
- **The registry** so exactly one surface attaches that shared entry's DOM at a
  time.

Reparenting the single `Terminal` between the `/coding` host div and a future
drawer host div preserves scrollback because scrollback lives in the in-memory
buffer of the `Terminal` instance, not in the DOM node it is opened into.

## 3. Identity and key model

- A session's foreground key is its **durable run identity when known, else its
  live session id**: `foregroundKey = agentRunId ?? sessionId`.
- Both consumers derive the key from the same `SessionMeta` (or, for the drawer,
  from the CODIN-748 seam's persisted session `agent_run_id`), so they always
  agree on the key for a given live run.
- The key migrates once, at the `tmp_* → serverId` + `agentRunId` transition in
  `terminalStore.setReady`. Migration is handled centrally (see §5) so a claim
  placed before ready survives the rekey.
- Doc-chat sessions (`isDocChat`) participate in the pool like any other
  session, but the drawer never claims their keys in this slice; they therefore
  always resolve to the `coding` owner (§4, Decision 3 of refinement).

## 4. Ownership registry — `studio/src/stores/terminalForegroundStore.ts` (NEW)

A small Zustand store, deliberately session-agnostic (it stores claims and host
targets, never session metadata). Placed at `stores/` root because it is shared
by `/coding` and drawer, mirroring where `stores/issue/drawerWorkspaceStore.ts`
sits relative to both.

Vocabulary: `ForegroundOwner = 'coding' | 'drawer'`, with **absence of any live
session for a key** representing the third "no foreground owner / backgrounded"
state — expressed as a `null` resolution rather than a stored value.

State:

- `claims`: map of foreground key → the owner currently claiming foreground.
  Only non-default (`drawer`) claims are recorded; `coding` is the implicit
  fallback, so an unclaimed live session is coding-eligible without any write.
- `hostTargets`: map of `ForegroundOwner` → the registered mount-target element
  (an `HTMLElement | null`) that surface uses to display the foregrounded
  session. `/coding` registers its target in this slice; the drawer registers
  its target in CODIN-751.

Actions (the adapter API):

- `acquire(key, owner)`: record a claim. Drawer-priority is intrinsic: a
  `drawer` claim overrides the `coding` default. `acquire(key, 'coding')` is a
  no-op equivalent to releasing, kept for symmetry/testability.
- `release(key)`: drop the claim for a key; the key reverts to coding-eligible.
- `releaseOwner(owner)`: drop **every** claim held by an owner — the primitive
  CODIN-751 calls on drawer close / issue switch to relinquish all sessions at
  once.
- `rekey(oldKey, newKey)`: move a claim from `oldKey` to `newKey`; used by the
  identity migration in §5.
- `registerHost(owner, el)` / `unregisterHost(owner)`: publish/retract a
  surface's mount-target element.

Selectors / helpers (pure, exported):

- `resolveOwner(state, key)`: returns `claims[key] ?? 'coding'`. This is the
  single source of truth for "who owns this key".
- `foregroundKey(meta)`: `meta.agentRunId ?? meta.sessionId`.
- `isCodingEligible(state, meta)`: `resolveOwner(state, foregroundKey(meta)) ===
  'coding'` — the boolean `TerminalHost` consumes to decide whether to attach.

Per-session, not global: a `drawer` claim on session X leaves session Y
coding-eligible, so distinct sessions can have distinct active owners
simultaneously (refinement Decision 2).

## 5. Session-lifecycle → registry wiring (`terminalStore.ts` edits)

`terminalStore` is the identity + lifecycle authority, so it is the single place
that migrates and releases claims deterministically (rather than relying on
adapter discipline):

- `setReady`: after the existing `tmp → server`/`agentRunId` rekey, call the
  registry `rekey(oldKey, newKey)` where `oldKey = foregroundKey(tempMeta)` and
  `newKey = foregroundKey(updatedMeta)`. No-op when the key is unchanged.
- `setExited`, `setError`, `closeTab`: call `release(foregroundKey(meta))` so a
  closed / exited / error session cleanly relinquishes any foreground claim,
  returning eligibility to `/coding` without touching the backend run. (These
  mutators already hold the target `SessionMeta`.)

These are the only edits to `terminalStore`; its existing dedupe
(`attachPersisted` by `agentRunId`) and indices are untouched.

## 6. Shared entry pool — extraction from `TerminalHost`

Extract the xterm/WebSocket **object lifecycle** out of `TerminalHost`'s
component-local `entriesRef` into a shared, module-level singleton so the
`Terminal`/WS pair for a session exists exactly once regardless of how many
surfaces reference it. Target module: `studio/src/coding/panes/terminalEntryPool.ts`
(NEW) — kept under `coding/panes` beside its only current caller; the drawer
host in CODIN-751 imports the same singleton.

The pool owns, per session id, the `Terminal`, its `FitAddon`, the WS handle,
last-known cols/rows, and the spawn flags currently held in `SessionEntry`. It
exposes:

- `syncEntries(sessions)`: create entries for new sessions and dispose entries
  for sessions that vanished — the logic currently in `TerminalHost`'s first
  effect (§ create/dispose). Disposal closes the WS and disposes the `Terminal`.
- `ensureConnected(sessionId, meta, callbacks)`: open the WebSocket for a
  session that is `connecting` and has no live handle, wiring the exact
  `onReady`/`onBytes`/`onError`/reconnect/`onClose` behavior that lives in
  `TerminalHost` today, including the `tmp → server` entry rekey inside
  `onReady`. Idempotent: a second call while a handle exists is a no-op, which is
  what makes a second WS viewer impossible.
- `getEntry(sessionId)`: accessor for the view layer's attach step.
- `disposeAll()`: unmount-time teardown (the current final effect).

WS callbacks continue to drive `terminalStore` (`setReady`, `setExited`, etc.)
exactly as today; only their residence moves. The `agentRunId`-carrying rekey in
`onReady` stays here and is the trigger paired with the registry `rekey` in §5.

## 7. `TerminalHost` refactor — registry-gated view

`TerminalHost` stays mounted exactly once in `TicketWorkspace` and keeps its
`/coding` `visibleId` derivation verbatim (doc-chat overlay > `activeByTask` >
none) — doc-chat arbitration remains an internal `/coding` sub-state and is not
touched (refinement Decision 3). Changes:

- On render it calls the pool's `syncEntries(sessions)` instead of mutating a
  local map, and registers its host div as the `coding` mount target via
  `registerHost('coding', el)` on mount / `unregisterHost('coding')` on unmount.
- It computes `visibleMeta = sessions[visibleId]` and gates presentation on
  `isCodingEligible(state, visibleMeta)`. When the drawer owns that session's
  key, the **effective** visible id becomes `null`: `TerminalHost` renders its
  inactive/empty box, does **not** attach the `Terminal` DOM, and does **not**
  open/close the WS. The pool entry, the `terminalStore` session, its tab, and
  its history chips are all left intact — `/coding` is backgrounded for that
  session, not torn down.
- When coding-eligible, it borrows the entry from the pool, calls
  `ensureConnected(...)` (WS opens lazily on first foreground, as today), and
  runs the attach path — the existing `mountedIdRef` guard, `scheduleFit` rAF
  coalescing, `onRender` corrective refit, `ResizeObserver`, and wheel→tmux
  bridge — all now operating on the shared entry rather than a local one.
- A session that is coding-visible one moment and drawer-claimed the next is
  detached (DOM removed from coding's host, `mountedIdRef` cleared) without
  disposing the entry, so re-acquisition by `/coding` after release re-attaches
  the same `Terminal` with its buffer intact.

Net effect for `/coding` when the drawer is closed or foregrounding a different
session: behavior is identical to today, because every key resolves to `coding`.

## 8. Adapter surface handed to CODIN-751

No drawer component is built here (refinement Decision 1). CODIN-751 will, using
only what this slice ships and the CODIN-748 seam:

- read task/session context from `IssueDrawerWorkspaceViewModel`
  (`terminals.sessions`, `launchContext`) rather than assembling
  project/module/profile props;
- derive a session's key via `foregroundKey` (from a live `SessionMeta`) or the
  persisted session's `agent_run_id`;
- `registerHost('drawer', el)` for its mount target and `acquire(key, 'drawer')`
  when its active tab / effective pane is terminal for that session;
- `release(key)` on tab-switch-away and `releaseOwner('drawer')` on drawer close
  / issue switch.

The single shared pool means the drawer host attaches the **same** `Terminal`
that `/coding` was using; no second pool, no second WS.

## 9. Tests (new: `studio/src/test/stores/terminalForegroundStore.test.ts` and pool/host tests under `studio/src/test/coding/panes/`)

Registry unit tests:

1. Default resolution is `coding` for an unclaimed key.
2. `acquire(key,'drawer')` makes `resolveOwner` return `drawer`; `release`
   reverts to `coding`.
3. Per-session isolation: claiming X does not change Y's resolution.
4. `releaseOwner('drawer')` clears all drawer claims at once.
5. `rekey(old,new)` moves a claim; the old key reverts to coding.

Pool + host integration tests (jsdom, driving `terminalStore` + registry):

6. **No duplicate**: bringing a session to `ready` and transferring ownership
   coding→drawer→coding creates the `Terminal` once and opens the WebSocket
   once (assert pool `syncEntries`/`ensureConnected` create-once; assert socket
   open count == 1 across transfers).
7. **Coding backs off**: with `acquire(key,'drawer')`, `TerminalHost` renders
   its inactive box, does not attach xterm DOM, and does not close the WS; the
   `terminalStore` session, tab entry, and history remain present.
8. **Scrollback / identity preserved**: after a coding→drawer→coding cycle the
   resolved session id and the same `Terminal` instance (hence its buffer) are
   unchanged; no respawn.
9. **Release on lifecycle**: `setExited` / `setError` / `closeTab` release the
   claim, returning the key to coding-eligible without a backend terminate call.
10. **`/coding` fallback**: with no drawer claims, `visibleId` presentation is
    byte-for-byte the current behavior (Details/terminal/doc-overlay switching,
    fit-on-activate) — guard against regressions in the existing
    `TicketWorkspace`/host tests.

## 10. Out-of-scope guards / risks

- **Rekey race**: the migration is centralized in `setReady` (§5), so a claim
  placed on a `tmp_*` key survives to the `agentRunId` key without a
  coding-flicker window that depends on adapter timing.
- **Cross-tree DOM (deferred)**: this slice does not relocate `TerminalHost` out
  of `/coding`. Actually mounting the shared `Terminal` into a drawer DOM node
  that lives in a different React subtree is a CODIN-751 concern; the pool +
  `registerHost` API are shaped to make that a target-element swap, not a second
  pool. If CODIN-751 finds the single-host-div model cannot reach the drawer
  tree, the fallback (documented, not built here) is to hoist the pool driver to
  a common ancestor — still one pool, still frontend-only. No wire-frame change
  is anticipated; §2 shows a frontend-only registry satisfies single-owner.
- Doc-chat overlay presentation is untouched and must stay green in existing
  tests.
