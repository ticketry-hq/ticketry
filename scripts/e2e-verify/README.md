# Checkout guard

Run the module tests with `npm run e2e:verify:test` (or
`node --test scripts/e2e-verify/*.test.mjs`). No app or Codex process is needed.

```js
import { snapshotCheckout, checkCheckout } from './checkout-guard.mjs';

const snapshot = await snapshotCheckout({
  repoDir,
  runDir,
  writeSets: ['docs/feature-map/example.md', 'studio/e2e/example.spec.ts'],
});
const result = await checkCheckout(snapshot);
```

Take the snapshot before launching agents. `writeSets` is the flattened union
of assigned paths: a bare path permits only that file; a trailing `/` permits
descendants of that directory. Paths are repository-relative and literal,
without glob expansion. The run directory is permitted separately. Backups of
existing dirty files in the supplied union live under `runDir/preexisting/`.
Use a fresh run directory; existing backups are never overwritten.

The snapshot is JSON-serializable and retains the initial file contents as
hashes, dirty-path flags, HEAD, staged index hash and stash count. Preserve this
same baseline across checks after each agent and at the end. A caller may use
`checkCheckout(snapshot, { writeSets })` to restrict the currently assigned
union. Include all potential writes in the initial snapshot's union so their
pre-existing contents are backed up before any agent edits them.

The result contains `fatal`, `violations`, and `changedFiles` arrays. Each
changed-file row has `path`, `change` (`created`, `modified`, or `deleted`),
`preexisting`, and `backupPath` (or `null`). Fatal entries identify changed
`head`, `indexHash`, or `stashCount`. Violations identify writes outside the
union and deletion of pre-dirty files; attribution is explicitly uncertain
between the sweep and concurrent edits. An unassigned dirty file has no backup.

The caller owns stopping agents and deciding the run's exit code. The guard
only observes Git state and writes backups; it never repairs the checkout.
It compares states at check boundaries, so transient edits or Git mutations
that are fully undone before a check cannot be detected.
