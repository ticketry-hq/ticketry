# cloneCollections only wraps structuredClone

Tag: `stdlib`. Confidence: high.

Location: `studio/src/features/settings/changeLedger.ts:59-63,243`.

The private five-line function has one caller and returns `structuredClone(input)` unchanged. It neither selects collection fields nor changes cloning behavior. Its narrower TypeScript parameter does not strip the loading and action fields present on the actual input.

Delete the helper and use `const nextConfirmed = structuredClone(input)` at its caller. If retaining the narrower declared type is useful, annotate the local as ConfirmedCollections. Keep the clone itself, since the ledger compares against a prior value.

Validation: typecheck and existing settings change-ledger tests. No new test is needed for forwarding to a native function.
