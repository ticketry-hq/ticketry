# Desktop release, update, recovery, and uninstall policy

Ticketry supports macOS on arm64 (Apple silicon) only, for one OS user on one
machine. Its backend sidecar is reachable on loopback only;
remote, hosted, multi-user, Windows, and Linux deployments are not supported.
Each supported target in `manifest.v1.json` is released as a versioned `.app`
and `.dmg`; the `.app` embeds the target-matched `muxed-backend` sidecar and
the native `ticketry-hook` lifecycle transport.
Application binaries are disposable release artifacts. User-owned data is not.

## Produce a release

Start each command block below at the repository root. Every block changes to
`studio/` before running an `npm run release:*` command. Both release flows
require a macOS arm64 host with the `aarch64-apple-darwin` Rust target
installed.

The supported flow for this release is an explicitly unsigned developer build.
It requires no Apple signing or notarization credentials:

```bash
cd studio
unset APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
unset APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
npm run release:build -- --target macos-aarch64 --allow-unsigned
```

This mode disables hardened runtime and entitlements in the Tauri override,
ad-hoc signs the bundle for integrity verification, and skips Gatekeeper
assessment because the artifact is unsigned and not notarized. Tauri's DMG
helper runs in its headless mode, without Finder-only icon positioning.
Supplying `--allow-unsigned` together with complete signing and notarization
credentials is rejected.

The unsigned flow does not replace the signed and notarized flow. If a
Developer ID certificate and notarization credentials become available, use
the following instead:

```bash
cd studio
export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Organization (TEAMID)'
# Choose one authentication set:
export APPLE_ID='releases@example.com'
export APPLE_PASSWORD='app-specific-password'
export APPLE_TEAM_ID='TEAMID'

# OR: APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH
npm run release:build -- --target macos-aarch64
```

Both modes require matching executable architectures and the embedded sidecar
and hook runner. They stage the `.app`, `.dmg`, and a
`release-metadata.json` compatibility record under
`release-output/<version>/<target>/`; that record explicitly states whether
the release is signed and notarized.

Before either build mode runs a frontend, sidecar, or bundle command, it
validates the release inputs declared by `release/manifest.v1.json`. This gate
reads and parses `backend/worktracker/reviewed_defaults.json`, then applies the
same finalized-defaults validator used by the review workbench. That tracked
file is the single source of truth for reviewed repository guidance, launch
prompts, state vocabulary, and workflow graphs; the workbench, backend seed
modules, release validator, and packaging recipe are consumers.

A failure beginning with `release defaults artifact` means the declared file
is missing or unreadable, is not JSON, or violates the reviewed-defaults
schema. Invalid-content messages name the offending issue type, state, or
transition edge. Correct the source artifact through the workbench finalization
flow and rerun the release command; do not copy or translate it for packaging.
The PyInstaller recipe bundles that same file directly, so the validated bytes
are the bytes embedded in the sidecar.

Packaging contains no state database, SQLite journal, migration snapshot, or
other database artifact. On a clean installation, the first sidecar launch
creates `state.db` in the application data directory and builds its schema from
the bundled Django migrations. Creating the first project then materializes
its issue types, start states, transition edges, and launch bindings from the
bundled `backend/worktracker/reviewed_defaults.json`. Those materialized rows
are project-owned after creation.

Run the ten installed-artifact scenarios against the staged application:

```bash
cd studio
npm run release:acceptance
```

That command uses the staged app for the manifest's single release target and
the acceptance driver shipped in `scripts/`. Pass an app path after `--` or set
`MUXED_DESKTOP_ACCEPTANCE_DRIVER` only when deliberately testing an alternate
artifact or driver.

## Publish only after installed-artifact acceptance

Publication is a separate, fail-closed operation. It never trusts a successful
cross-compile or a build-only check. For every target, `release:publish` copies
the staged `.app` to a temporary installation outside the checkout and invokes
the acceptance driver in a sanitized environment. The driver launches the
installed main executable and records clean-install, upgrade/recovery,
uninstall/data, packaged-skill, diagnostic, and durable repository → agent →
terminal → relaunch evidence with bounded readiness and shutdown checks.

The driver must write the required, redacted JSON result. A missing driver,
failed scenario, or unredacted diagnostic stops before the publisher is run.

```bash
cd studio
export MUXED_DESKTOP_ACCEPTANCE_DRIVER=/absolute/path/to/installed-app-driver
export GITHUB_REPOSITORY='owner/private-repository'
export GITHUB_TOKEN='a-scoped-token-with-private-repository-contents-write-access'
export MUXED_RELEASE_PUBLISH_COMMAND='["node","scripts/github-release-publisher.mjs","--target","macos-aarch64","--tag","0.2.0"]'
npm run release:publish -- --target macos-aarch64
```

The destination repository must be private. This is a publish-time guard
only: the publisher checks repository visibility when an actual publish is
attempted and refuses to publish unsigned artifacts to a repository that is
not private. `release:validate` and CI never consult repository visibility,
so a public source repository keeps a green pipeline. This repository is
private, so its unsigned releases are available only to collaborators with
repository access. If it becomes public, the publisher refuses to upload an
unsigned build. Keep `GITHUB_TOKEN` in the environment only; the publisher
never includes it in logs or release notes.
The local and remote `0.2.0` tags must already exist, and an existing release
on that tag is never overwritten. Publishing the supported unsigned developer
build requires a separate acknowledgement:

```bash
cd studio
export MUXED_DESKTOP_ACCEPTANCE_DRIVER=/absolute/path/to/installed-app-driver
export GITHUB_REPOSITORY='owner/private-repository'
export GITHUB_TOKEN='a-scoped-token-with-private-repository-contents-write-access'
export MUXED_RELEASE_PUBLISH_COMMAND='["node","scripts/github-release-publisher.mjs","--target","macos-aarch64","--tag","0.2.0"]'
npm run release:publish -- --target macos-aarch64 --acknowledge-unsigned
```

## Open an unsigned release on a recipient Mac

These steps are necessary because this release is unsigned and unnotarized.
After copying `Ticketry.app` to `/Applications`, try to open it once. macOS
will block the quarantined application. Open **System Settings → Privacy &
Security**, scroll to the security message for Ticketry, click **Open Anyway**,
then confirm **Open**. On macOS 15 and newer, do not rely on
right-clicking the app and choosing **Open**; that no longer bypasses
quarantine for an unnotarized app.

Ticketry never overwrites an existing user-owned or locally modified provider
skill. If startup reports a packaged-skill collision, the named path has been
preserved unchanged. A release acceptance account with such a collision is not
clean: repeat the recipient test in a new macOS user account. For an existing
account, back up and rename the reported conflicting skill directory, relaunch
Ticketry, and use **Retry**. Do not delete or replace the conflicting directory
unless its owner has explicitly decided how its contents should be retained.

## Update and rollback

This initial release has no automatic in-app updater. Updates are **verified
manual installers**: before replacing an installed app, support/release staff
compare the candidate `release-metadata.json` with the installed release and
require compatible `app_version`, `sidecar_version`, `runtime_protocol`, and
`database_schema` values, plus identical `signed` and `notarized` status. A
candidate with a mismatched embedded component, an incompatible
protocol/schema, or weaker signing status must not be installed without an
explicit release decision.

Keep the prior launchable `.app` and the two most recent installers until the
new app has launched, its sidecar has migrated the existing state database,
and the user can access their existing workspace.

Immediately before a pending schema migration, the sidecar checkpoints the
existing `state.db` and creates a private pre-migration snapshot beside it in
the application data directory. The default directory is
`~/.config/worktracker-studio`; a launch with `MUXED_DATA_DIR` set uses that
directory instead. Snapshots are named:

```text
state.db.pre-migration.1  newest
state.db.pre-migration.2
state.db.pre-migration.3  oldest
```

At most three generations are retained. A new snapshot shifts generations 1
and 2 older and removes the previous generation 3. No snapshot is created for
a fresh database or a launch with no pending migration. These snapshots are
upgrade recovery points, not periodic backups.

If the post-update check fails, quit Ticketry before touching its data
directory and retain a copy of the affected directory for support. To restore
a snapshot, choose the generation from immediately before the migration, then
replace `1` below if an older generation is required:

```bash
cd "${MUXED_DATA_DIR:-$HOME/.config/worktracker-studio}"
test -f state.db.pre-migration.1
umask 077
cp state.db.pre-migration.1 state.db.restore
chmod 600 state.db.restore
mv -f state.db.restore state.db
rm -f state.db-wal state.db-shm
```

Restore a launchable application version compatible with the restored
snapshot, then launch it and confirm the workspace is accessible. Do not roll
back a database after a forward migration: either restore the application
version that can read the migrated database, or restore a pre-migration
snapshot together with an application version that can read that snapshot.

## Known release gap

CI runs its single `Desktop and sidecar` job on `macos-14`. It runs the Studio,
backend, SDK, and Rust test/build checks, builds and verifies the host-native
sidecar, runs the release contract tests, and runs `release:validate`.
`release:validate` checks manifest structure, declared files and migrations,
component versions, and the finalized-defaults artifact validation gate. It
does not check credentials, repository visibility, or perform a real release
build; it passes whether the repository is private or public. CI never runs
`release:build`, bundles a `.app` or `.dmg`, signs, notarizes, runs
installed-artifact acceptance, or publishes. The packaging path can therefore
rot undetected between manual releases. Closing this gap is deliberately out
of scope because of macOS runner cost and the absence of signing credentials.

## Data ownership and uninstall

The sidecar is always launched with the desktop application's platform data
directory, outside the `.app` and `.dmg`. Upgrades preserve that directory,
including WorkTracker data, preferences, approved executable choices, and
compatible agent login state. Removing the application from `/Applications` or
discarding the installer never deletes this data.

An uninstall that also removes user data must be an explicit, separately
confirmed support action after the user has exported or backed up the state.
It must name the data directory and the categories above; no installer or
uninstaller may silently remove them.
