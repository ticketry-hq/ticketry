# Renderer measurement reset has no caller

Status: **historical — closed by CODING-1487.** That story removed the
`ghostty-wasm` renderer and moved the measurement seam to
`studio/src/features/agents/terminal/internal/rendererMeasurement.ts`, which no
longer exports `resetRendererMeasurements`. See
[`../docs/archive/ghostty-wasm-restore.md`](../docs/archive/ghostty-wasm-restore.md).
The finding below is kept as written.

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/agents/terminal/ghostty-wasm/internal/rendererMeasurement.ts:162-164`.

resetRendererMeasurements clears the sample map, but no test, script, or application source calls it. The published window hook exposes rendererMeasurements, not this reset function.

Delete the unused reset export. Keep sample recording, summaries, and the window hook used by the comparison driver. Do not remove the measurement system because this convenience API is dead.

Validation: whole-repository search and frontend typecheck. Any future measurement campaign needing a reset can add it with an actual caller.
