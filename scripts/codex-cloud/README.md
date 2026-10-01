# Ticketry in Codex Cloud

This directory owns the reproducible setup for frontend and portable Rust work.
The supporting Rust GraphQL/browser adapter uses Ticketry's services and an
isolated SQLite profile. Native macOS checks remain in `.github/workflows/ci.yml`.

## Create the environment

Make these files available on the GitHub branch used for environment setup.
In **Settings > Codex Cloud > Environments > Create environment**, select
`ticketry-hq/ticketry` and use the following setup request:

> Prepare Ticketry for frontend and portable Rust development on Debian/Ubuntu
> Linux. Install Node.js 22, then run `bash scripts/codex-cloud/install.sh` from
> the repository root. Use `scripts/codex-cloud/start/SKILL.md` as the start skill.
> Test the prepared environment with `bash scripts/codex-cloud/check.sh all`.
> Report any failing checks and macOS-only checks separately before publishing.

The **Install script** field should call:

```bash
bash scripts/codex-cloud/install.sh
```

Use the instructions in [start/SKILL.md](start/SKILL.md) for the **Start skill**.
Keep the environment private initially. Review the setup report and publish
after the checks pass; start a fresh task to verify the published environment.

The current hosted flow documents an install script and start skill, rather
than a repository Dockerfile or a cloud configuration manifest that it imports
automatically. [Official OpenAI documentation](https://learn.chatgpt.com/docs/environments/cloud-environments)

## Dependencies and access

- Node 22 matches desktop CI. npm and `package-lock.json` are used here to
  match CI; the repository's pnpm declaration and workflow are unchanged.
- Rust and SeaORM CLI versions come from the checked-in toolchain and Cargo
  lockfile. The installer prepares rustfmt and clippy, the SQLite code generator,
  Chromium, tmux, and [Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/).
- Allow package-manager downloads, GitHub, Rust toolchain downloads, Chromium
  downloads, and Debian/Ubuntu package mirrors. During setup, inspect failed
  downloads for their exact redirect/CDN hosts and add those hosts if needed.
  Rust Git dependencies use GitHub HTTPS, so package-manager access alone may
  be insufficient.
- No application secrets, production database, Postgres server, signing keys,
  or personal provider logins are part of the base environment. Private Git
  dependencies require separately configured GitHub access.
- npm's SSH GitHub dependency URL is rewritten to HTTPS only for installation
  and child processes. The installer preserves inherited Git authentication
  settings and does not change global Git configuration or either lockfile.

## Work and validation

```bash
bash scripts/codex-cloud/start.sh
bash scripts/codex-cloud/check.sh frontend
bash scripts/codex-cloud/check.sh rust
bash scripts/codex-cloud/check.sh graphql
bash scripts/codex-cloud/check.sh e2e
bash scripts/codex-cloud/check.sh e2e e2e/project-lifecycle.spec.ts
```

Run the startup command only for interactive inspection. It stays in the
foreground and uses temporary SQLite data; stop it with SIGTERM or Ctrl-C.
The frontend URL and data directory are printed at startup. Logs go to
`.ticketry-dev/logs/ticketry.log`. Playwright manages a separate temporary
profile and runtime, so a running inspection server is not a prerequisite.

`check.sh` defaults to the frontend checks. `all` also runs portable Rust tests,
generated-contract drift checks, and browser E2E. Provider-launch tests may
require additional CLI installations and authentication; a test failure is
not permission to supply production credentials or change product behavior.

The Rust checks exclude `ticketry` and `ticketry-desktop`, avoiding the shipping
shell's native resources/sidecar staging. This also excludes root integration
and boundary tests; those remain in macOS CI along with native terminal tests,
desktop E2E, release packaging, signing, and notarization. A passing cloud suite
does not replace those checks.

When lockfiles change, rerun `install.sh` in the affected task. Update and
republish the environment for future tasks. Published preparation and task
state are distinct; repository refresh preserves caches but does not rerun
installation/startup. [Environment lifecycle](https://learn.chatgpt.com/docs/environments/cloud-environments)

## Reproduce on Linux locally

The Dockerfile calls the same installer. Docker must have a running Linux
daemon. Build from the repository root:

```bash
docker build -f scripts/codex-cloud/Dockerfile -t ticketry-codex-cloud .
docker run --rm --init ticketry-codex-cloud bash scripts/codex-cloud/check.sh all
```

The image contains a source snapshot and prepared dependency/build caches.
Rebuild it after source or dependency changes. The companion ignore file
excludes local credentials, databases, dependencies, native libraries, and
build output. No production filesystem or Docker socket mount is needed.

Local verification of these scripts on macOS does not establish Linux or
published-cloud readiness. Complete the Docker or cloud setup checks before
using the environment as a validated starting point.
