# Desktop release, update, recovery, and uninstall policy

Ticketry 0.2.0 supports macOS on arm64 for one OS user on one machine. The
application contains the Rust runtime, GraphQL transport, MCP listener, terminal
authority, and `ticketry-hook` lifecycle spool writer. It does not require or
ship a separate product service.

## Create and custody the updater key

The updater key pair is separate from Apple code signing and notarization.
Generate the production pair once on a secured release-operator machine. Write
the private key outside the repository:

```bash
npm run tauri -- signer generate -w /secure/path/ticketry-updater.key
```

This invokes `tauri signer generate`. Install the private key contents in CI as
`TAURI_SIGNING_PRIVATE_KEY` and its password as
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public key belongs in the packaged
Tauri updater configuration. Never put the private key, its password, or either
CI secret in the repository, release assets, or build logs.

The named custodian is the Ticketry release owner. The release owner keeps one
offline backup of the private key in sealed storage and keeps its password in a
separate password-manager record. Record each access and test that the backup
can be restored before relying on it for a production release.

## Produce a release

Run these commands from `studio/` on a macOS arm64 host with the
`aarch64-apple-darwin` Rust target installed.

For a local unsigned acceptance artifact:

```bash
npm run release:build -- --target macos-aarch64 --allow-unsigned
```

Unsigned output is for local acceptance only. The public publisher must refuse
it.

For production, provide `APPLE_SIGNING_IDENTITY` and either the Apple ID
credential set (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) or the API-key
set (`APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`). CI must also
provide `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The updater credentials add archive
signing; they do not replace Apple signing or notarization.

```bash
npm run release:build -- --target macos-aarch64
```

The build validates version agreement, builds Studio and the Rust desktop,
checks the app and hook architectures, and enforces signing and notarization.
It stages the `.app`, `.dmg`, signed `.app.tar.gz` updater archive, matching
`.app.tar.gz.sig`, and `release-metadata.json` under
`release-output/0.2.0/macos-aarch64/`.

## Publish the stable update feed

The configured public releases repository is
`ticketry-hq/ticketry-updates`. Its authentication-free stable feed URL is:

```text
https://github.com/ticketry-hq/ticketry-updates/releases/latest/download/latest.json
```

Run the public update publisher for the `macos-aarch64` target and the exact
release version tag. The publisher verifies that the destination is the
configured public repository and that release metadata says `signed: true` and
`notarized: true`. It then writes `latest.json`; operators must never create or
edit that file by hand.

The publisher writes the Tauri static JSON fields `version`, non-empty `notes`,
`pub_date`, and `platforms.darwin-aarch64.signature` and `.url`. It attaches the
signed `.app.tar.gz`, its `.sig`, and `latest.json` to the same stable GitHub
release. The archive URL in `latest.json` must point to that release asset.

Mark every test or preview GitHub release as a prerelease. GitHub excludes a
prerelease from `releases/latest`, so it cannot replace the stable feed. After
publishing, fetch the stable feed URL without credentials and confirm that its
archive URL and signature match the uploaded assets.

## Recipient acceptance

Run installed-artifact acceptance against the staged app in a clean macOS user
account. It must demonstrate startup, existing-data adoption, provider launch,
terminal lifecycle, in-process MCP registration, actionable recovery notices,
and the absence of a retired runtime executable. Keep its redacted evidence
with the release record.

Ticketry never overwrites a user-owned or locally modified provider skill. If
startup reports a packaged-skill collision, preserve the named path. Use a new
account for clean-install acceptance, or back up and rename the conflicting
directory before retrying.

## In-app update and rollback

Ticketry reads the stable feed without a GitHub credential. It may check for an
update, but it downloads and installs only after the user requests the update
in Settings. `automatic_updates` remains `false`; there is no silent install.

Before installing, Ticketry verifies the updater signature. Release validation
also requires signed and notarized metadata. Do not install an incompatible
`runtime_protocol` or `database_schema`, or a weaker signing state.

Keep the prior launchable app and the two most recent installers until the new
app launches, adopts the existing database, and opens the existing workspace.
The Rust migration authority checkpoints data before a schema migration. Use
that checkpoint and the retained app for rollback.

### Manual install fallback and key-loss recovery

Use the signed and notarized DMG as the manual install fallback when the feed is
unavailable, an updater error prevents installation, or rollback requires an
older compatible version. Preserve application data and complete the normal
shutdown lifecycle before replacing the app.

Key loss strands every installed copy that trusts the lost key. Generate a new
updater key pair, replace the CI secrets, and package the new public key. Recovery
requires one manually installed release, distributed as a signed and notarized
DMG, that carries the new public key. In-app updates can resume only after users
install that release manually. A feed entry signed only by the new key cannot
recover an older installed copy.

## Uninstall

Removing `Ticketry.app` does not remove user data. The platform application-data
directory retains WorkTracker data, preferences, approved executable paths,
and compatible provider login state. Delete that directory only when the user
explicitly requests permanent data removal and has confirmed any needed backup.
