# T687-1 — Coding tab: route + nav entry + placeholder shell — LLD

## Scope lock

Frontend-only, additive. This slice gives Studio a project-scoped **Coding**
destination that routes to a **placeholder panel** rendered in Studio's existing
dark/mono theme. Nothing else.

In scope:

- A `coding` view recognized by Studio's router and store.
- A react-router route `/projects/:projectId/coding` plus a reserved nested splat
  `/projects/:projectId/coding/*` for Muxed's future store-driven internal
  nav.
- A project-gated **Coding** entry in `NavDrawer`.
- A placeholder `CodingView` rendered through `ContentHost`.

Explicitly **out of scope** (do not touch):

- No Muxed code, terminal, transport, or WebSocket — that is **#691**.
- **No scoped theme wrapper, no style isolation.** The panel inherits Studio's
  theme as-is. Global-CSS containment is deferred to #691 (per refinement
  Decision 3; HLD Q3 is moot for this slice).
- No coupling to #685 (the `Blocked by CODIN-685` link is struck).

## Repo facts this plan builds on

- Routing lives in `studio/src/app/routes.tsx`: a `Shell` wraps project-scoped
  routes; `useRouteSync` pushes URL params into the stores; `ContentHost`
  renders from `activeView`.
- `studio/src/stores/studio/studioStore.ts` owns the `View` union's runtime
  guard via `VIEWS` + `normalizeView`. The `View` type is declared in
  `studio/src/lib/types.ts`.
- `NavDrawer` (`studio/src/shell/NavDrawer.tsx`) renders grouped `Dest[]`
  sections via `NavSection`; each item links to
  `/projects/${selectedProjectId}/${dest.view}` and is disabled when no project
  is selected.
- `ContentHost` (`studio/src/shell/ContentHost.tsx`) is an `activeView` branch
  switch; backlog/board use `overflow-hidden` (own their scroll), the rest share
  a padded scroll container.

## The routing subtlety (decision-complete)

Today `/projects/:projectId/:view` is the only dynamic match, so `coding` would
flow through it as `params.view`. But this ticket also reserves the nested splat
`/projects/:projectId/coding/*`. In React-router v6, a route with a **static**
`coding` segment outranks the fully dynamic `:view` route. Once the splat route
exists, **even the bare `/projects/:projectId/coding` URL matches the splat
route**, where `params.view` is `undefined` and `params["*"]` is `""` (an empty
but *defined* string). Nested paths like `/coding/foo` give `params["*"] ===
"foo"`.

Therefore the view cannot be derived from `params.view` for the coding surface.
**Decision:** treat the presence of the splat param as the coding signal.

- In `useRouteSync`, the effective view becomes: if `params["*"]` is defined →
  `"coding"`; otherwise `normalizeView(params.view)`.
- This is unambiguous because only the coding splat route populates `params["*"]`;
  all other Shell routes leave it `undefined`.
- `coding` is still added to the `View` union / `VIEWS` array so `setView`,
  `activeView` comparisons, and `NavSection` active-highlighting are type-safe and
  correct.

## Source files to modify

| File | Change |
| --- | --- |
| `studio/src/lib/types.ts` | Add `"coding"` to the `View` union (place before `"settings"`). |
| `studio/src/stores/studio/studioStore.ts` | Add `"coding"` to the `VIEWS` array (before `"settings"`) so the guard accepts it. |
| `studio/src/app/routes.tsx` | Add the splat route `/projects/:projectId/coding/*` → `ContentHost`, placed before the `/projects/:projectId/:view` route. In `useRouteSync`, read `params["*"]` and force the view to `"coding"` when it is defined, else keep `normalizeView(view)`. The `key`-present (drawer) early-return stays first. |
| `studio/src/lib/icons.tsx` | Add one new icon export for the nav entry, following the existing `IconProps`/`Icon` wrapper pattern (a code-brackets or terminal glyph). |
| `studio/src/shell/NavDrawer.tsx` | Import the new icon; add a one-item `CODE` section (see placement below) rendered via `NavSection`, between `PLAN` and the bottom Settings nav. |
| `studio/src/shell/ContentHost.tsx` | Import `CodingView`; add an `activeView === "coding"` branch returning a full-height `main` with `overflow-hidden bg-pane-bg` and `data-testid="content-coding"` (mirrors the board branch, since #691 will mount a scroll-owning surface). |

## New files

| File | Purpose |
| --- | --- |
| `studio/src/views/CodingView.tsx` | The placeholder panel. |
| `studio/src/test/codingRoute.test.tsx` | Route + nav + placeholder coverage. |

## NavDrawer placement decision

Add a dedicated single-item section labeled **CODE**, between `PLAN` and the
pinned Settings block. Rationale: Coding is an *execution* surface (the eventual
per-ticket terminal / coding-agent pane from #687), conceptually distinct from
TRACK ("where work is now") and PLAN ("how it's organized over time"). A separate
group keeps that distinction legible and avoids implying it is a tracker view.

- Entry: `{ view: "coding", label: "Coding", Icon: <new icon> }`.
- It reuses `NavSection` + `NavDrawerItem` unchanged: project gating
  (disabled + `opacity-50` when no project), `data-testid="nav-coding"`, and
  active styling via `activeView === "coding"` all come for free.
- The item's link resolves to `/projects/${selectedProjectId}/coding`, which
  matches the splat route and yields `activeView === "coding"`.

## CodingView placeholder spec

- Structure mirrors existing views: a root `flex h-full flex-col`, a `ViewHeader`
  titled **Coding** (count `0` or omitted), and a body region.
- Project guard: when `selectedProjectId` is null, render the same centered
  "Select a project…" empty state idiom other views use (covers direct-URL hits;
  the nav itself is already gated).
- Body copy: a brief centered placeholder stating the per-ticket coding pane is
  not mounted yet and lands in #691. No interactivity.
- **No theme wrapper, no scoped styles.** It uses Studio's existing token classes
  (`bg-pane-bg`, `text-text-muted`, etc.) exactly like its siblings.

## Test plan (`codingRoute.test.tsx`)

Additive only; existing route/nav/view tests must stay green.

1. **Nav entry renders & gates.** With a selected project, `nav-coding` renders as
   a link to `/projects/<id>/coding`. With no project, it renders disabled
   (`aria-disabled`, not a link).
2. **Base route.** Rendering at `/projects/<id>/coding` sets `activeView` to
   `coding`, highlights the nav item (`aria-current="page"`), and renders
   `content-coding` with the placeholder.
3. **Nested splat.** Rendering at `/projects/<id>/coding/anything` still resolves
   `activeView === "coding"` and renders the placeholder (proves the splat +
   `params["*"]` rule).
4. **No regression.** A non-coding view (e.g. `/projects/<id>/board`) still
   resolves normally and does not render `content-coding`.

## Acceptance criteria (from refinement)

- [ ] Project-scoped **Coding** entry in `NavDrawer`, gated on a selected project.
- [ ] Selecting it routes to `/projects/:projectId/coding` with the nested splat
      `/projects/:projectId/coding/*` reserved.
- [ ] The route renders a placeholder panel in `ContentHost` (no Muxed code).
- [ ] Panel renders in Studio's existing dark/mono theme as-is (no scoped wrapper).
- [ ] Existing Studio views and tests unaffected (additive route + nav).

## Validation

- `npm run -w studio test` (or the repo's studio test task) — new file green,
  existing suites unchanged.
- `npm run -w studio build` / typecheck — `View` union change compiles cleanly
  across all `activeView` consumers.
- Manual: nav gating with/without a project; base and nested coding URLs render
  the placeholder; other views unaffected.
