# T2 — Define and produce the final Ticketry desktop release build

Status: Refined
Story: WorkTracker #2 (`491b2369-4105-4744-be42-377d1a0c35d5`)
Date: 2026-07-28

## Summary

Ticketry will ship version `0.1.0` as a **single-architecture macOS arm64
desktop build**, distributed as an **unsigned developer build** to a private
GitHub Release for a friends-and-family audience.

The repository already contains a fail-closed release pipeline
(`release-build.mjs`, `installed-artifact-acceptance.mjs`,
`release-publish.mjs`) that was written for a *signed and notarized* release.
No Developer ID Application certificate exists and none will be obtained.
This story therefore does two things:

1. Narrows the pipeline's declared scope to what will actually be released and
   accepted — one architecture, one version, unsigned.
2. Supplies the two pieces the pipeline requires but the repository does not
   contain: the installed-artifact acceptance driver and the publisher command.

Producing the artifact is the final step, not the first.

## Verified starting state

Every claim below was read from the working tree on 2026-07-28.

### Version

`0.1.0` appears in six places: `package.json:4`, `studio/package.json:4`,
`studio/src-tauri/tauri.conf.json:4`, `studio/src-tauri/Cargo.toml:3`,
`studio/release/manifest.v1.json:3`, and per-target `app_version` /
`sidecar_version` at `studio/release/manifest.v1.json:87-88,106-107`.

`release-build.mjs:81-86,106-113,185-196` validates that the manifest,
`tauri.conf.json`, and `Cargo.toml` agree with `release_version` and throws on
mismatch. It never reads either `package.json`, so those two can drift
silently. Nothing writes or syncs versions.

### Targets

`manifest.v1.json:71-110` declares `macos-aarch64` and `macos-x86_64`.
`release-build.mjs:129-139,385-400` defaults `--target` to `all`, selecting
both. The sidecar is built per-architecture under
`arch -${build_architecture}` (`release-build.mjs:357-362`) and PyInstaller
receives no target flag (`backend/packaging/build-sidecar.sh:28-35`), so no
universal binary is producible without an added `lipo` merge step that does not
exist. `release-build.mjs:274-297,337-349` verifies the app, embedded sidecar,
and hook with `lipo -archs` against the manifest architecture.

### Signing

`release-build.mjs:91-103` hard-fails before any build work when
`APPLE_SIGNING_IDENTITY` is absent, or when neither
`APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` nor
`APPLE_API_KEY`/`APPLE_API_ISSUER`/`APPLE_API_KEY_PATH` is complete.
`release-build.mjs:299-300` then requires both
`codesign --verify --deep --strict` and `spctl --assess --type execute` to
succeed. There is no unsigned fallback or skip mode.

The signing host holds exactly one identity:
`Apple Development: Chandramouly K Kandachar (MK94JUXFC8)`. An Apple
Development certificate cannot sign for distribution and Apple's notary
service rejects it. `notarytool` is present; no `APPLE_*` variables are set.

### Installed-artifact acceptance

`installed-artifact-acceptance.mjs` copies the `.app` to a temporary
`Applications/Ticketry.app`, cold-launches it through LaunchServices as
`/usr/bin/env -i <sanitized> /usr/bin/open -W -n <app>` (lines 121-135), then
runs the absolute-path driver from `MUXED_DESKTOP_ACCEPTANCE_DRIVER` and
validates the JSON it wrote to `MUXED_DESKTOP_ACCEPTANCE_RESULT`.

It requires **ten** boolean scenarios (lines 9-20): `clean_install`,
`upgrade_with_existing_data`, `failed_update_recovery`,
`uninstall_preserves_data`, `missing_dependency_diagnostic`,
`os_permission_diagnostic`, `durable_agent_terminal_flow`,
`offline_packaged_skill_matrix`, `skill_configuration_unchanged`,
`skill_overlay_cleanup`; plus `packaged_skill_providers` evidence that each of
`claude`, `codex`, `agy`, `gemini` discovers `grill-with-docs`, `to-spec`, and
`to-tickets` (lines 22-23, 70-84); plus at least two credential-redacted
diagnostics including kinds `missing_dependency` and `os_permission`
(lines 85-106).

**No driver exists in the repository.** `release-publish.mjs:26-37,45-56` runs
acceptance for every selected target and executes the publisher only if all
pass, so publication is currently impossible.

### Publication

`release-publish.mjs:22-25,45-50` accepts an arbitrary publisher argv array
from `MUXED_RELEASE_PUBLISH_COMMAND` and inherits `process.env`. It has no
built-in destination and **no publisher ships in the repository**. It reads the
manifest to select targets and locate the staged app; it does not update the
manifest. `release-build.mjs:303-334` writes a separate
`release-metadata.json` beside the staged `.app` and `.dmg` under
`release-output/<version>/<target>/`.

### CI — the ticket's premise is stale

`.github/workflows/ci.yml` has one job, `Desktop and sidecar`, on **`macos-14`**
(lines 8-12). It runs typecheck, Studio tests, web build, backend pytest,
**builds and verifies the host-native sidecar** (lines 42-45), prepares
libghostty, runs Python SDK and Rust tests, and runs release contract tests
plus `release:validate` (lines 57-60).

`OPERATIONS.md:103-110` claims CI "runs tests and release-policy validation on
Ubuntu" and "does not build the sidecar". **Both statements are false.** The
real remaining gap is narrower: CI never runs `release:build`, bundles a
`.app`/`.dmg`, signs, notarizes, runs installed-artifact acceptance, or
publishes. `release:validate` checks manifest structure and version agreement
only — never credentials or a real build.

### Other defects found

- `installed-artifact-acceptance.mjs:145` sets the acceptance data directory to
  `Library/Application Support/muxed-studio`. That path appears nowhere else in
  the codebase; the real default is `~/.config/worktracker-studio`
  (`backend/apps/settings_store/local_state_migration.py:17`,
  `studio/src-tauri/src/ownership.rs:244`, `OPERATIONS.md:68`). Acceptance
  passes it via `MUXED_DATA_DIR` so the app still honors it, but acceptance
  never exercises the real default path.
- `installed-artifact-acceptance.mjs:151-156` comment says "seven acceptance
  scenarios"; the required list has ten.
- The cold launch awaits `open -W` to completion *before* starting the driver
  (lines 121-135 vs 151-156), so the driver cannot observe the first launch.
- `OPERATIONS.md:17-26` documents `npm run release:build` without stating that
  it is defined only in `studio/package.json:12`, not at the repository root.

## Decisions

| Question | Decision |
| --- | --- |
| Release version | `0.1.0`, shipped as-is. No bump. |
| Target architecture | `macos-aarch64` only. `macos-x86_64` removed. |
| Signing / notarization | None. Unsigned developer build via an explicit opt-in flag. No Apple Developer Program enrolment. |
| Acceptance driver | Does not exist; building it is in scope. |
| Publication destination | Private GitHub repository release on a version tag, invited collaborators only. |
| macOS CI release gap | Out of scope. Release stays a manual operation. |
| Packaged-skills dependency | Hard blocker on CODIN-1467. |

### Rationale

- **0.1.0 as-is** avoids touching six version sources for a release whose
  audience already knows what they are installing. The cost is accepted: a
  released `0.1.0` is indistinguishable from prior dev `0.1.0` builds, so the
  git tag is the only durable identifier.
- **arm64 only** because accepting `macos-x86_64` requires launching the
  installed app on Intel hardware, which is unavailable. A cross-compiled
  sidecar that was never launched is not evidence. Keeping a target in the
  manifest that will never be accepted makes `OPERATIONS.md`'s support claim
  false.
- **Unsigned over enrolment** is the user's cost decision. It is recorded here
  as a deliberate, documented weakening rather than an oversight: recipients
  must clear the quarantine attribute themselves, which macOS 15+ routes
  through System Settings → Privacy & Security → "Open Anyway".
- **Private repository release** limits who can obtain an unsigned macOS
  application. A public download of an unsigned app is not acceptable for this
  artifact.
- **Blocking on CODIN-1467** keeps the acceptance contract honest. Three of the
  ten required scenarios and all provider evidence describe packaged-skills
  behavior that does not exist yet; relaxing them for convenience would remove
  the only automated check that the packaged sidecar exposes its skills.

## Goals

1. `manifest.v1.json`, `OPERATIONS.md`, and the release scripts agree that
   exactly one target — `macos-aarch64` — is supported and released.
2. `release:build` can produce a staged, verified, ad-hoc-signed `.app`/`.dmg`
   without any Apple credential, only under an explicit opt-in.
3. Unsigned status is recorded in `release-metadata.json` and cannot be
   mistaken for a signed release downstream.
4. An installed-artifact acceptance driver exists and satisfies the harness's
   full evidence contract on real installed artifacts.
5. A publisher exists that creates a private GitHub Release on a version tag
   and attaches the `.dmg` with integrity digests and quarantine instructions.
6. `0.1.0` is produced, accepted, and published, and the commands that did it
   are documented accurately enough to repeat.

## Non-goals

- Apple Developer Program enrolment, Developer ID signing, or notarization.
- Universal (arm64 + x86_64) binaries or any `lipo` merge step.
- An in-app automatic updater. Updates remain verified manual installers.
- Closing the macOS CI release gap.
- Windows or Linux targets.
- Public distribution of an unsigned artifact.
- Any version bump or version-sync tooling.

## Requirements

### R1 — Single supported target

`macos-x86_64` is removed from `manifest.v1.json`. `--target` defaults to the
sole remaining target; `all` continues to work and resolves to one target.
`OPERATIONS.md`'s support sentence is corrected to arm64-only.
`desktop-smoke.mjs:40-53` currently maps every non-arm64 macOS `process.arch`
to `x86_64-apple-darwin`; on an arm64-only product that branch must fail with a
clear unsupported-host error rather than silently selecting a target that no
longer exists.

Removal is a documentation and manifest change only. No build logic that
handles multiple targets is deleted, so restoring Intel later is a manifest
addition plus acceptance on real hardware.

### R2 — Explicit unsigned developer-build mode

`release-build.mjs` gains an opt-in flag (`--allow-unsigned`). Default
behavior is unchanged: absent the flag, missing credentials remain a hard
failure.

With the flag:

- The `APPLE_SIGNING_IDENTITY` and notarization credential gates
  (`release-build.mjs:91-103`) are skipped.
- The Tauri signing config override (`release-build.mjs:116-126`) omits
  `signingIdentity`; hardened runtime and entitlements handling must be
  resolved explicitly rather than left implicit, and whichever is chosen must
  be asserted by a test.
- The bundle is ad-hoc signed (`codesign -s -`) so that
  `codesign --verify --deep --strict` still passes. Bundle integrity remains
  verified.
- `spctl --assess --type execute` is **not** required, because an
  un-notarized bundle cannot pass it. The skip is logged explicitly, naming
  the flag as its cause.
- All architecture verification (`lipo -archs`), embedded-sidecar, and
  embedded-hook checks remain mandatory and unchanged.

If both `--allow-unsigned` and a complete credential set are present, the
build fails rather than guessing which the operator meant.

### R3 — Unsigned status is recorded and propagates

`release-metadata.json` (`release-build.mjs:303-334`) gains explicit
`signed: false` and `notarized: false` fields for an unsigned build, and the
corresponding `true` values for a signed one. Absence of the fields is not
treated as signed.

`release-publish.mjs` reads them and refuses to publish an unsigned artifact
unless publication is separately and explicitly acknowledged as unsigned. A
signed-release publication path must never silently accept unsigned input.

`OPERATIONS.md`'s update-compatibility comparison gains signing status to the
values support staff must check, so a signed release is never replaced by an
unsigned one without an explicit decision.

### R4 — Acceptance harness corrections

Prerequisites for a driver that can pass:

- The acceptance data directory becomes the product's real default
  (`~/.config/worktracker-studio`) relative to the sandboxed home, replacing
  `Library/Application Support/muxed-studio`
  (`installed-artifact-acceptance.mjs:145`).
- The stale "seven acceptance scenarios" comment (line 151) is corrected to
  ten.
- The cold-launch ordering is resolved so the required first-launch evidence is
  observable: either the driver starts before the cold launch, or the harness
  documents that `clean_install` evidence is gathered by the driver's own
  subsequent launch and the `open -W` call is a liveness precondition only.
  The chosen semantics must be stated in the file and covered by a test.

The ten-scenario list, provider list, and required skill list are **not**
relaxed.

### R5 — Installed-artifact acceptance driver

A driver is added to the repository, invoked via
`MUXED_DESKTOP_ACCEPTANCE_DRIVER` with the installed `.app` path as its sole
argument, writing its JSON result to `MUXED_DESKTOP_ACCEPTANCE_RESULT`.

It must operate entirely inside the sanitized environment
(`installed-artifact-acceptance.mjs:45-56`): restricted `PATH`, loopback-only
proxies, sandboxed `HOME` and `MUXED_DATA_DIR`. It must not read the
developer's real home, keychain, or checkout, and must never emit a credential
— `assertAcceptanceResult` rejects diagnostics matching its credential pattern
(lines 98-100).

Evidence required, per the harness contract:

| Scenario | Evidence |
| --- | --- |
| `clean_install` | Fresh sandboxed home; app launches, sidecar starts, workspace reachable. |
| `upgrade_with_existing_data` | Pre-seeded `state.db` survives launch; pre-migration snapshot generations behave per `OPERATIONS.md:64-80`. |
| `failed_update_recovery` | Snapshot restore procedure yields a launchable app with accessible workspace. |
| `uninstall_preserves_data` | Removing the `.app` leaves the data directory and its contents intact. |
| `missing_dependency_diagnostic` | Absent `tmux` (an external prerequisite per the manifest) produces a redacted, actionable diagnostic. |
| `os_permission_diagnostic` | A denied OS permission produces a redacted, actionable diagnostic. |
| `durable_agent_terminal_flow` | repository → agent → terminal → relaunch survives an app restart. |
| `offline_packaged_skill_matrix` | **Blocked on CODIN-1467.** All four providers discover all three skills with no network. |
| `skill_configuration_unchanged` | **Blocked on CODIN-1467.** User/provider config byte-identical after launch and termination. |
| `skill_overlay_cleanup` | **Blocked on CODIN-1467.** Run-scoped overlays removed on termination. |
| `packaged_skill_providers` | **Blocked on CODIN-1467.** Per-provider discovered-skill arrays. |

The seven unblocked scenarios are implementable and testable now. The driver
must be structured so the three blocked scenarios plus provider evidence are
separable additions, and must fail — never report `true` — while they are
unimplemented.

Automation mechanism is an implementation decision for the driver ticket. It
must be constrained to the sandboxed environment, must not require the
operator's interactive session state, and must fail closed on timeout.

### R6 — GitHub Releases publisher

A publisher is added, invoked through `MUXED_RELEASE_PUBLISH_COMMAND`.

- Target: a **private** GitHub repository release on a version tag matching
  `release_version`. Download requires invited collaborator access.
- The release attaches the staged `.dmg` and its `release-metadata.json`, plus
  a recorded content digest for each attached file.
- Notes state plainly that the build is unsigned and not notarized, name the
  minimum macOS version (`11.0`, `manifest.v1.json:84`), name `tmux` as an
  external prerequisite, and give the quarantine-clearing steps recipients
  will need.
- Credentials come from a scoped GitHub token read from the environment, never
  from a committed file, and are never echoed.
- The publisher is idempotent-safe: it refuses to overwrite an existing release
  for the same tag rather than silently replacing a published artifact.
- It refuses to run if the tag does not exist or does not match
  `release_version`.

### R7 — Documentation correctness

`OPERATIONS.md` is corrected:

- The support sentence states arm64-only (R1).
- The stale "Known release gap" paragraph (lines 103-110) is rewritten: CI runs
  on `macos-14` and does build and verify the sidecar; the real gap is that CI
  never bundles, signs, notarizes, runs installed-artifact acceptance, or
  publishes. The out-of-scope statement stays, with its actual reason —
  runner cost and the absence of signing credentials.
- The unsigned release path is documented as a first-class supported flow with
  its exact commands, alongside the signed flow it does not replace.
- Recipient-side quarantine instructions are included, with an explicit note
  that they exist because the build is unsigned.
- The required working directory (or `--workspace @worktracker/studio`) is
  stated for every `npm run release:*` command.

`docs/desktop-executable-policy.md` is reviewed for statements that an
unsigned distributed build would contradict, and reconciled.

### R8 — Produce the release

Executed only after R1–R7 and CODIN-1467:

1. `release:validate` passes.
2. `release:build --target macos-aarch64 --allow-unsigned` stages the `.app`,
   `.dmg`, and `release-metadata.json` under `release-output/0.1.0/macos-aarch64/`.
3. `release:acceptance` passes all ten scenarios against the staged `.app`.
4. The version tag is created.
5. `release:publish` publishes to the private GitHub Release.
6. The artifact is installed from the published `.dmg` on a clean arm64 macOS
   user account, following only the published instructions, and launches to a
   usable workspace.

Step 6 is the story's real acceptance: the published artifact, installed the
way a recipient would install it.

### R9 — Verification

- Release-script unit tests cover: single-target resolution; unsigned mode
  skipping credential gates; unsigned mode still enforcing `codesign --verify`,
  `lipo`, sidecar, and hook checks; `--allow-unsigned` plus credentials being
  rejected; `signed`/`notarized` metadata fields; publish refusing unsigned
  input without acknowledgement; publish refusing a mismatched or absent tag.
- Acceptance-harness tests cover the corrected data directory, the documented
  cold-launch semantics, and that a driver omitting any blocked scenario fails.
- Driver tests cover the seven unblocked scenarios and assert no credential
  appears in any diagnostic.
- `release:validate` continues to pass in CI on `macos-14` with the
  single-target manifest.

## Dependency-ordered implementation sequence

```text
T-1 single target ──┐
                    ├──> T-3 docs correctness ──┐
T-2 unsigned mode ──┤                           │
                    └──> T-6 publisher ─────────┤
                                                │
T-4 harness fixes ──> T-5 acceptance driver ────┤
                            ▲                   │
                            │                   ▼
                     CODIN-1467 ──────────> T-7 produce 0.1.0
                     (packaged skills)
```

1. **T-1 Single target** — no dependencies.
2. **T-2 Unsigned build mode** — no dependencies; independent of T-1.
3. **T-4 Acceptance harness corrections** — no dependencies; prerequisite for
   any driver that can pass.
4. **T-3 Documentation correctness** — needs T-1 and T-2 decided in code.
5. **T-5 Acceptance driver** — needs T-4. Blocked by CODIN-1467 for three
   scenarios and provider evidence.
6. **T-6 GitHub Releases publisher** — needs T-2 (metadata fields) and T-5
   (publication is gated on acceptance).
7. **T-7 Produce and verify 0.1.0** — needs all of the above and CODIN-1467.

## File change map

- `studio/release/manifest.v1.json` — remove `macos-x86_64` (T-1)
- `studio/release/OPERATIONS.md` — support claim, stale CI paragraph, unsigned
  flow, quarantine steps, working directory (T-1, T-3)
- `studio/scripts/release-build.mjs` — `--allow-unsigned`, ad-hoc signing,
  `spctl` skip, metadata fields (T-2, T-3)
- `studio/scripts/release-build.test.mjs` — unsigned-mode coverage (T-2)
- `studio/scripts/desktop-smoke.mjs` — unsupported-host error (T-1)
- `studio/scripts/installed-artifact-acceptance.mjs` — data directory, stale
  comment, cold-launch semantics (T-4)
- `studio/scripts/installed-artifact-acceptance.test.mjs` — harness coverage
  (T-4)
- new acceptance driver under `studio/scripts/` plus its tests (T-5)
- `studio/scripts/release-publish.mjs` — unsigned gate, tag validation (T-3,
  T-6)
- `studio/scripts/release-publish.test.mjs` — publish coverage (T-6)
- new publisher script plus its tests (T-6)
- `docs/desktop-executable-policy.md` — reconcile with unsigned distribution
  (T-3)

Unchanged: all six version sources; `backend/packaging/*`;
`studio/src-tauri/tauri.conf.json`; `.github/workflows/ci.yml`.

## Acceptance criteria

- `manifest.v1.json` declares exactly one target and `OPERATIONS.md` claims
  support for exactly that target.
- `release:build --allow-unsigned` succeeds on a host with no `APPLE_*`
  variables and no Developer ID certificate, producing a staged `.app` and
  `.dmg` that pass `codesign --verify --deep --strict` and all architecture,
  sidecar, and hook checks.
- `release:build` without the flag still fails closed on absent credentials.
- `release:build --allow-unsigned` with a complete credential set fails.
- `release-metadata.json` records `signed: false` and `notarized: false`, and
  `release:publish` refuses that artifact without explicit unsigned
  acknowledgement.
- `release:acceptance` passes all ten scenarios against the staged `.app` in a
  sandboxed home with no network, and no diagnostic contains a credential.
- A driver missing any blocked scenario fails rather than reporting success.
- `release:publish` creates a private GitHub Release on the `0.1.0` tag with
  the `.dmg`, its metadata, digests, and quarantine instructions; it refuses a
  duplicate tag and a mismatched tag.
- A clean arm64 macOS user account installs from the published `.dmg` using
  only the published instructions and reaches a usable workspace.
- `OPERATIONS.md` contains no false statement about CI, the supported
  architecture, signing status, or command working directories.

## Open risks

- **CODIN-1467 gates the release.** Four pieces of acceptance evidence depend
  on packaged skills. If that story slips, T-7 cannot complete, and the only
  alternatives are relaxing the contract or absorbing its scope — both
  explicitly rejected here.
- **Unsigned distribution is a permanent property of this artifact.** Every
  recipient performs a quarantine-clearing step. Teaching that habit is a real
  cost the audience choice accepts, and it is why the release is private.
- **Acceptance-driver scope is the largest unknown** in the story. Seven
  scenarios spanning install, upgrade, snapshot recovery, uninstall, two
  diagnostics, and a durable agent/terminal flow are broad, and the harness
  offers no automation primitives.
- **`0.1.0` is not a unique identifier.** The git tag is the only durable way
  to distinguish this release from prior dev builds of the same version.
- **CI still cannot detect packaging rot,** by decision. The bundle, sign, and
  acceptance path is exercised only when someone releases manually.
