# Decision — retire the remaining Ninja HTTP lane

**Work item:** CODING-166  
**Status:** decided  
**Authoritative record:**
`backend/worktracker/docs/adr/0007-one-drf-http-surface-and-one-generated-http-contract.md`

## Decision

The remaining 35 Ninja HTTP routes move to DRF. Once the last route has moved,
the Ninja API aggregator, route allowlist, Ninja-only schemas and packaging,
and the `django-ninja` dependency are removed.

The migration uses these boundaries:

- Ordinary model CRUD uses DRF model viewsets and model-derived serializers.
- Resource lifecycle operations use thin custom DRF views over existing
  application services; moving frameworks does not move orchestration into
  serializers, middleware, signals, or DRF save hooks.
- The terminal-run creation view makes one public service call. That service
  coordinates persistence and tmux effects and delegates focused tasks to the
  existing lower-level functions.
- Synchronous terminal/tmux calls run through Django's handling of synchronous
  DRF views. No custom pool is introduced without measured contention.
- All migrated HTTP routes enter the canonical OpenAPI document and both
  generated SDKs. This contract expansion is deliberate and must be reviewed as
  part of the implementation that performs it.
- Channels consumers and WebSocket wire contracts do not move to DRF and are
  outside this decision.

## Why

The completed audit found no correctness need for async HTTP handlers in the
remaining lane. Retaining Ninja would preserve a second framework and a second,
manually typed HTTP contract after the original reason for both had disappeared.
The route registry already prevents undeclared surface growth, so this is a
consolidation decision rather than an urgent correctness repair.

## Implementation scope created by this decision

This child records the decision only. Follow-up implementation must migrate the
routes in behavior-preserving slices, expand and regenerate the contract, update
callers for deliberate resource-shape changes, remove the allowlist as it
shrinks, validate terminal concurrency and compensation, and remove Ninja only
after no HTTP route depends on it.

The sibling contract-phase cleanup and all Channels consumer changes remain out
of scope.
