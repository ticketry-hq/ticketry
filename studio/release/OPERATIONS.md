# Desktop release, update, recovery, and uninstall policy

Ticketry 0.2.0 supports macOS on arm64 for one OS user on one machine. The
application contains the Rust runtime, GraphQL transport, MCP listener, terminal
authority, and `ticketry-hook` lifecycle spool writer. It does not require or
ship a separate product service.

## Produce a release

Run these commands from `studio/` on a macOS arm64 host with the
`aarch64-apple-darwin` Rust target installed.

For a local unsigned acceptance artifact:

```bash
npm run release:build -- --target macos-aarch64 --allow-unsigned
```

For a signed production artifact, provide `APPLE_SIGNING_IDENTITY` and either
the Apple ID credential set (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) or
the API-key set (`APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`), then
run:

```bash
npm run release:build -- --target macos-aarch64
```

The build validates the manifest and version agreement, builds Studio and the
Rust desktop, verifies the app and hook architectures, verifies signing and
notarization policy, and stages the `.app`, `.dmg`, and
`release-metadata.json` under `release-output/0.2.0/macos-aarch64/`.

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

## Update and rollback

This release has no automatic updater. Before installing a verified manual
update, compare `app_version`, `runtime_protocol`, `database_schema`, `signed`,
and `notarized` in the candidate metadata with the installed release. Do not
install an incompatible schema/protocol or weaker signing state without an
explicit release decision.

Keep the prior launchable app and the two most recent installers until the new
app launches, adopts the existing database, and opens the existing workspace.
The Rust migration authority checkpoints data before a schema migration; use
that checkpoint and the retained app for rollback.

## Uninstall

Removing `Ticketry.app` does not remove user data. The platform application-data
directory retains WorkTracker data, preferences, approved executable paths,
and compatible provider login state. Delete that directory only when the user
explicitly requests permanent data removal and has confirmed any needed backup.
