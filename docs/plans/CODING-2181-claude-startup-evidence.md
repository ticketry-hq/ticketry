# CODING-2181 isolated Claude startup evidence

Date: 2026-09-25. Installed CLI: Claude Code 2.1.282.

I launched Claude in a disposable Git repository and its external Worktree. A temporary Rust example called `ticketry_provider::provider_contract(Provider::Claude).construct_launch` for each directory. The resulting interactive command used Ticketry's `--settings`, `--mcp-config`, `--permission-mode auto`, and initial prompt argument. It did not use print mode or a permission bypass.

Each process received disposable `HOME`, `CLAUDE_CONFIG_DIR`, and XDG directories. Provider credential environment variables were removed. The hook and MCP commands pointed to inert disposable fixtures. The probe sent no trust choice or workflow prompt keystrokes. Both repositories, the configuration directories, and the temporary launch example were removed after the probe. Terminal captures were inspected in memory and were not saved.

The sandboxed attempt ended before trust with `api.anthropic.com: ENOTFOUND`. With network access, both fresh processes first displayed Claude's theme picker. After selecting a theme in the disposable configuration, the primary process displayed a login-method picker. It did not reach a directory-trust dialog. No disposable authentication credential was supplied.

This evidence establishes that the installed 2.1.282 binary accepted Ticketry's interactive launch shape through first-run setup. It does **not** establish trust-dialog appearance, approval or decline behavior, prompt consumption, or durable trust across a second process. Those installed-provider acceptance cases remain open until a disposable authenticated account is available. An authentication or setup screen is not evidence that the initial prompt was consumed.
