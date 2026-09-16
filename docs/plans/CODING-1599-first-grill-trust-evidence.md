# CODING-1599 provider trust verification

Gemini CLI 0.59.0 consumes Ticketry's persisted module approval and enables
stdio MCP without `--skip-trust`. An external Git worktree remains untrusted
after module approval. This is an integration finding, not a successful
end-to-end first-Grill result.

## Reproduce

```sh
cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-launch --test gemini_directory_trust -- --ignored --nocapture
```

The opt-in test uses the installed `gemini` executable, or
`TICKETRY_TEST_GEMINI`, and Node. It creates disposable provider configuration,
a Git repository and an external Git worktree. It calls the same public
`DirectoryTrustSetup.prepare` contract as module setup, then invokes the real
provider from each directory. A local stdio MCP fixture isolates directory
trust from WorkTracker authentication and unrelated MCP configuration.

| Provider CWD and setup | Gemini MCP result |
| --- | --- |
| New module, before approval | Disabled because folder is untrusted |
| Module, after explicit approval | Connected |
| External Git worktree, only module approved | Disabled because folder is untrusted |
| External Git worktree, separately approved | Connected |

The separate worktree approval is a diagnostic control. Ticketry does not
currently perform that step during module setup.

After each approval, the test starts Gemini with
`-p 'Selected workflow prompt: Grill. Ask the first clarification question.'`.
Both directories reach `Please set an Auth method` without an untrusted-folder
warning. Credentials are absent from the isolated child environment, so this
stops before any model request. MCP connectivity is verified separately by
`gemini mcp list`; the authentication refusal alone does not prove MCP works.

## Integration finding

`setModuleFolder` approves only the linked folder before saving its ModuleLink.
`LaunchPathsService` selects the top-level task owner's active/conflict
worktree path when it exists. That checkout can be outside the module folder.
The installed Gemini trust matcher checks the actual path against folder
rules; it does not inherit approval through Git's common directory.

Production Gemini launch material still includes `--skip-trust`, which masks
this missing persisted approval. This verification deliberately omits that
flag. A successful production launch with the flag would not demonstrate that
module setup covered the worktree.

Existing UI acceptance cases 295 and 296 prove module setup completion and
retry through the native-command boundary. They stop at story creation and
do not launch Grill. The provider test exercises the public Rust setup and
real CLI boundaries separately; it does not drive the complete desktop flow.

## Validation

- Installed-provider MCP verification passed with Gemini CLI 0.59.0.
- Removing module approval made the Connected assertion fail with
  untrusted/Disabled output. Restoring approval passed in 6.98 seconds.
- All nine existing Rust directory-trust tests passed.
- The complete overhaul gate passed: 133 files, 451 tests.
- No product implementation, live provider configuration, authentication,
  generated contracts, or unrelated MCP configuration was changed.
