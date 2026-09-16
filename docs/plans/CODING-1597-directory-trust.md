# CODING-1597 directory trust investigation

The crate-root capability is implemented for Gemini CLI 0.59.0. No live
provider configuration was changed. The original report does not identify the
affected provider; Gemini is the verified candidate from earlier startup evidence.

## Verified provider mechanism

Installed Gemini CLI version: 0.59.0.

[Gemini's directory trust documentation](https://geminicli.com/docs/cli/trusted-folders/)
documents persisted folder approval and `GEMINI_CLI_TRUSTED_FOLDERS_PATH`.
The installed bundle is under
`/Users/karthik/.vite-plus/js_runtime/node/24.21.0/lib/node_modules/@google/gemini-cli/bundle/`.
In `chunk-S4PJ76PA.js`:

- Lines 362105–362345 implement the persisted map of directory paths to
  `TRUST_FOLDER`, `TRUST_PARENT`, or `DO_NOT_TRUST`. Existing paths are resolved
  through realpath. The longest original normalized rule key wins; insertion
  order breaks ties. Folder approval includes
  descendants; parent approval applies to the rule path's parent.
- Line 252182 normalizes paths to lowercase on macOS and Windows.
- Line 253146 selects the explicit trust-file override, otherwise
  `$GEMINI_CLI_HOME/.gemini/trustedFolders.json`, falling back to OS home.
- The writer accepts JSON with comments, validates rules, locks using
  proper-lockfile's `<file>.lock` directory, rereads and merges, then writes a
  random temporary file with mode 0600 and renames it. An advisory file lock
  alone does not coordinate with that writer. Lock paths follow the canonical
  config file target.

There is no persisted trust subcommand in the installed help. `/permissions`
offers interactive approval. `--skip-trust` only bypasses trust for the session.
Directory approval does not establish hook trust, tool permissions, or MCP
authentication. Gemini's runtime environment can still force restricted mode
or override workspace trust; persisted approval is not a claim about those
runtime settings.

## Capability and integration

`ticketry-launch` owns a private directory-trust module. Its crate root exports
`DirectoryTrustSetup` and `DirectoryTrustOutcome`, reusing `Provider`.
`DirectoryTrustSetup::new(provider, trust_file)` binds the configuration file;
`DirectoryTrustSetup::from_environment(provider)` resolves Gemini's configured
location without changing it.
`prepare(directory, approved)` returns `Prepared`, `AlreadyTrusted`, or
`Refused`, with filesystem/configuration and unsupported-provider failures
reported as errors. An explicit approval decision governs any write.
`studio/src-tauri/tests/fixtures/public-api.txt` records these two exports.

Existing denials require a decision in Gemini itself. Ticketry rejects
commented JSON, unknown rules, relative rule keys or environment paths, and symlinked trust files
without modifying them. A busy lock returns a retryable `WouldBlock` error.
The writer places an owner marker in its lock directory so Gemini cannot evict
it as stale during a slow write. A crashed writer therefore needs manual lock
cleanup after confirming the writer is gone.

JSON rule order is preserved because Gemini uses it to break ties. Codex's
existing inline TOML serialization explicitly sorts keys to retain its command
format when serde_json's order-preservation feature is enabled.

CODING-1598 owns setup orchestration. ModuleLink persistence belongs to the
worktracking tier and cannot import execution capabilities. Invoke preparation
from an appropriate higher-tier boundary. Keep
`desktop_validate_module_folder` read-only.

Trust applies to actual canonical working directories. Isolated worktrees can
live outside the linked module folder, so they require their own approval;
approving a broad worktree ancestor would grant more trust than requested.
Future worktree setup must address this before launch without changing run or
worktree identity.

## Behavioral coverage

`ticketry-launch/tests/directory_trust.rs` tests the crate-root setup contract
with isolated provider configuration:

- Approve a linked folder and observe persisted approval on a subsequent call.
- Reuse an already-trusted shared folder without changing unrelated rules.
- Check a changed folder independently of the previous module link.
- Require separate approval for an isolated worktree outside the linked folder.
- Refuse without writing, then allow an explicit retry.
- Preserve explicit denial and configuration data on failure; allow retry after
  a busy lock or configuration error is resolved.

Existing `run_launch_paths.rs` covers CWD selection for module fallback,
active/conflict worktrees, shared descendants, and missing checkout fallback.
Those tests do not verify provider trust.

## Provider verification

A standalone Rust driver called the public setup contract against a temporary
module and trust file. The installed Gemini bundle's exported
`loadTrustedFolders().isPathTrusted()` then read that exact file, with both
Gemini home and trust-file location isolated under `/private/tmp`.
It returned no configuration errors, `true` for the approved module, and no
matching rule for a separate unapproved worktree. This verifies persisted
approval consumption, not a full Grill launch; CODING-1599 owns launch evidence.

## Validation results

- `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-launch`:
  62 passed, comprising 27 unit tests, nine directory-trust cases, and 26
  existing integration cases. Doc tests passed.
- The unchanged `tests/public_api_boundary_contract.rs` was compiled as a
  standalone Rust test against the workspace's built syn dependency and run
  with `CARGO_MANIFEST_DIR` set to `studio/src-tauri`: passed. This exercises
  the same source/fixture audit without linking the desktop application.
- `git diff --check` for the affected tracked files: passed.
- No Studio UI behavior changed in this capability ticket. CODING-1598 owns
  setup UI acceptance coverage and the overhaul gate.
