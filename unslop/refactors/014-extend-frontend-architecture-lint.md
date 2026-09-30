# Frontend lint checks only two import spellings in the state folder

Status: implemented. The lint check now uses the TypeScript parser and exact importer/target exceptions. Regression tests cover side-effect and dynamic imports, re-exports, import types, newly added exception targets, and import-like comments.

The review evidence below records the pre-fix behavior.

Priority: P3. Effort: Small. Category: Hygiene and prevention.

## Evidence

- [studio/package.json](../../studio/package.json), line 36, `"lint:client-store": "eslint src/state"`.
- [studio/eslint.config.js](../../studio/eslint.config.js), line 5, `files: ["src/state/*.ts", "src/state/**/*.ts"]`.

## Why change it

The build runs a lint command scoped to src/state. Its only rule bans two exact paths to shared/api/types. It does not check feature placement, shell-to-feature boundaries, or alternate ways of importing record types. It passes while the oversized central store and shell-owned document implementation remain. This is a gap in enforcement, not evidence that the existing lint command is broken.

## Smallest useful refactor

Add focused architecture checks for agreed dependency directions and state ownership. Cover equivalent relative import spellings or resolve imported modules before checking ownership. Introduce checks for new violations first, with an explicit list for existing migrations. Avoid a blanket line-count failure for generated files, fixtures, and tests.

## Validation

Add positive and negative fixtures for each rule, including a forbidden type reached through a different relative path. Run checks across application source and keep the build command aligned with that scope. The existing client-store lint passed during this review.

## Follow-up review

Partially addressed. The new architecture check and its three tests pass. However, [frontend-architecture-lint.mjs](../../studio/scripts/frontend-architecture-lint.mjs), lines 31 and 72, misses side-effect imports and exempts whole importing files. Direct probes returned no violations for `import "../../app/startup"` in a new feature and a new app target imported by the allowlisted workspaceStore. Parse all import forms and grandfather exact importer/target pairs. Add both negative fixtures so existing exceptions cannot silently expand. Priority P3.
