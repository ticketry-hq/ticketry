# readModules is an unused forwarding function

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/projects/queries/readTransport.ts:120-122`.

readModules merely returns the modules field from readProjectOpen. No source, test, script, or barrel references it. Real module loading is implemented through loadModules and Apollo query consumers.

Delete the three-line function. Keep readProjectOpen and modulesFromProjectOpen. This removes an unused second name for an existing read.

Validation: whole-repository symbol search and frontend typecheck. This file already has unrelated uncommitted edits, so apply the deletion without reverting surrounding work.
