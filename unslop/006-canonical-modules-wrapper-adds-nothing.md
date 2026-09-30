# canonicalModules discards its identity and returns another adapter's result

Tag: `shrink`. Confidence: high.

Location: `studio/src/features/projects/queries/index.ts:27-35`.

canonicalModules calls modulesFromProjectOpen, saves the result in a local, discards projectId with `void`, and returns the unchanged result. It adds no canonicalization, ordering, validation, or caching. Its name suggests another transformation that does not exist.

Replace each `canonicalModules(projectId, data)` call with `modulesFromProjectOpen(data)` and delete the nine-line helper. Keep the real adapter and its module-presentation ordering behavior.

Validation: frontend typecheck and existing module order acceptance tests. Review the current uncommitted changes in this file's surrounding feature before applying the cleanup.
