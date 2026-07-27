# Module recency arrives through an injectable provider

`studioStore` and the workitems selectors are generic-relevant core, but the available recency signal comes from Coding-only `AgentRun` activity under `/api/runs/module-activity`. The generic store must not import that endpoint directly.

## Decision

Load project modules through a generic module-recency provider interface with a default no-op provider. The default returns no activity and preserves the API module order. The Coding overlay registers a provider that calls the existing `/api/runs/module-activity?project_id=...` endpoint.

The shared sort helper is generic and pure: merge `{ [module_id]: isoTimestamp }` onto modules as `last_activity`, sort modules with timestamps newest first, and leave modules without timestamps in their original relative order at the end. `/coding` and Studio should both call the same helper so the module pane and workitems surfaces cannot drift.

## Alternatives Rejected

- Hard-code `/api/runs/module-activity` in `studioStore`: simpler, but leaks Coding-only `AgentRun` activity into generic-relevant core.
- Sort independently inside each workitems selector: avoids store-level wiring, but creates multiple ordering definitions and misses `EpicRail`.
- Add `last_activity` to the generic WorkTracker modules API now: too broad for this slice; the signal is currently Coding-overlay activity, not a generic tracker concept.

## Consequences

- Sorting once in `useStudioStore.selectProject` propagates to backlog epic groups, `EpicRail`, board swimlanes, story map columns, and sprint epic groups because those surfaces already consume `useStudioStore.modules` order.
- Generic remains portable: without a registered provider it behaves exactly as it does today.
- Tests should cover the pure sort, the no-op fallback, Coding provider registration, and representative consumers that rely on module order.
