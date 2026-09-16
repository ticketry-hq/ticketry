# State catalog increments a global generation nobody reads

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/shared/stateCatalogRevision.ts:3,23,33-41`.

Every advance increments both a per-project revision and a global generation. The exported stateCatalogGeneration and stateCatalogChangedSinceGeneration functions have no callers anywhere in the repository.

Delete generation, its increment, and these two accessors. Keep the per-project revisions, authoritativeStates map, and overlayAuthoritativeState. The workflow editor actively uses the latter to reconcile state rows after a stale load.

Validation: whole-repository symbol search, frontend typecheck, and state-update convergence acceptance tests. Per-project revision behavior remains unchanged.
