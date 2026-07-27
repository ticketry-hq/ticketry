# Desktop release, update, recovery, and uninstall policy

Muxed Studio supports macOS on arm64 (Apple silicon) and x86-64 (Intel), for
one OS user on one machine. Its backend sidecar is reachable on loopback only;
remote, hosted, multi-user, Windows, and Linux deployments are not supported.
Each supported target in `manifest.v1.json` is released as a versioned `.app`
and `.dmg`; the `.app` embeds the target-matched `muxed-backend` sidecar.
Application binaries are disposable release artifacts. User-owned data is not.

## Produce a release

Use a macOS signing host with the matching Rust target installed. The release
command requires a Developer ID signing identity and either Apple-ID or App
Store Connect API-key notarization credentials:

```bash
export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Organization (TEAMID)'
# Choose one authentication set:
export APPLE_ID='releases@example.com'
export APPLE_PASSWORD='app-specific-password'
export APPLE_TEAM_ID='TEAMID'

# OR: APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH
npm run release:build -- --target macos-aarch64
```

The release build rejects absent credentials, an unsigned/not-notarized bundle,
a missing embedded sidecar, and app/sidecar architectures that do not match the
manifest target. It stages the signed `.app`, `.dmg`, and a
`release-metadata.json` compatibility record under
`release-output/<version>/<target>/`.

## Publish only after installed-artifact acceptance

Publication is a separate, fail-closed operation. It never trusts a successful
cross-compile or a build-only check. For every target, `release:publish` copies
the staged `.app` to a temporary installation outside the checkout, launches it
through macOS LaunchServices using a sanitized environment, and requires a GUI
automation driver to record clean-install, upgrade/recovery, uninstall/data,
diagnostic, and durable repository → agent → terminal → relaunch evidence.

The driver must write the required, redacted JSON result. A missing driver,
failed scenario, or unredacted diagnostic stops before the publisher is run.

```bash
export MUXED_DESKTOP_ACCEPTANCE_DRIVER=/absolute/path/to/installed-app-driver
export MUXED_RELEASE_PUBLISH_COMMAND='["/absolute/path/to/publisher", "upload"]'
npm run release:publish -- --target macos-aarch64
```

## Update and rollback

This initial release has no automatic in-app updater. Updates are **verified
manual installers**: before replacing an installed app, support/release staff
compare the candidate `release-metadata.json` with the installed release and
require compatible `app_version`, `sidecar_version`, `runtime_protocol`, and
`database_schema` values. A candidate with a mismatched embedded component or
an incompatible protocol/schema must not be installed.

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

If the post-update check fails, quit Muxed Studio before touching its data
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

CI runs tests and release-policy validation on Ubuntu, but it does not build
the sidecar, bundle the macOS application, sign it, or submit and verify it for
notarization. The packaging path can therefore rot undetected between manual
releases. Closing this gap is deliberately out of scope here: it requires
signing credentials, an Apple developer account, and a separate decision about
macOS-runner cost.

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
