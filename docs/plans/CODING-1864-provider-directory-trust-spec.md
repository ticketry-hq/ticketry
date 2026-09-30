# CODING-1864: Provider directory trust during folder setup

## Problem Statement

A user links a Module folder and launches an agent, but Codex or Claude can stop at a first-directory trust dialog hidden inside tmux. The workflow prompt is not consumed and Ticketry reports a generic runtime failure. Ticketry already has an explicit folder-trust confirmation, but its current setup prepares only Gemini.

## Solution

Extend the existing approved folder setup so Codex and Claude receive durable trust for the actual working directory before Ticketry saves the Module link. Preserve Gemini support. Present provider-specific refusals and setup failures where the user selects the folder, with a safe retry.

Use the shared provider contract delivered by prerequisite CODING-1866. That Story owns the required provider interface for models, efforts, profiles, trust, and launch. This Story supplies the Codex and Claude trust behavior behind that interface; it must not introduce a second provider abstraction.

## User Stories

1. As a user creating a Module, I want approved folder setup to prepare provider trust so my first agent reaches its workflow prompt.
2. As a user replacing a Module folder, I want the same setup checks so replacement is as reliable as creation.
3. As a user selecting a missing Module folder, I want the same trust flow so launch recovery has no hidden extra step.
4. As a user, I want the confirmation to identify the directory and providers receiving trust so my approval is informed.
5. As a user who already trusted Gemini, I want explicit confirmation before Ticketry writes new Codex or Claude trust.
6. As a user whose directory is already trusted by all required providers, I want setup to complete without another confirmation or unnecessary writes.
7. As a user declining approval, I want no trust changes and no new Module link saved.
8. As a user who explicitly denied provider trust, I want Ticketry to preserve that denial and explain how to resolve it in the provider.
9. As a user with customized provider configuration, I want unrelated settings and application state preserved.
10. As a user with an overridden provider config location, I want setup and launch to use the same configuration.
11. As a user selecting a symlinked directory, I want trust to refer to its validated canonical directory.
12. As a user selecting a nonexistent directory or a file, I want an actionable error before configuration is changed.
13. As a user facing a lock, malformed config, or unsupported provider version, I want an honest setup failure rather than apparent success.
14. As a user retrying partial setup, I want completed approvals preserved and remaining work retried safely.
15. As a user replacing a folder, I want a failed setup to retain the previous Module link.
16. As a user creating a task Worktree, I want trust checked for that actual directory with explicit approval for any new trust write.
17. As a user restarting a provider, I want directory trust to persist across processes.
18. As a maintainer adding providers, I want trust behavior to follow the shared provider contract and its validation requirements.

## Implementation Decisions

### Dependency and ownership

- CODING-1866 remains a blocking prerequisite. Consume its trust inspection and approved preparation contract. Concrete signatures follow that Story's delivered interface.
- Provider implementations own configuration resolution, effective trust interpretation, and provider-specific writes. Native desktop orchestration coordinates inspection, consent, and setup outcomes. The frontend displays results and saves the Module link through the existing model contract.
- Keep implementation modules private and focused, respect crate dependency tiers, and expose approved items only from crate roots. Update public API boundary tests for any deliberate export changes.
- No new product REST API, provider registry, mirrored frontend state, or replacement model CRUD is needed. Apollo remains the frontend state owner.

### Module setup and consent

- Use the existing shared Module-folder setter for creation, missing-folder selection, and replacement. Await successful trust setup before the existing Module-link write.
- Require an absolute path, canonicalize it, and validate an existing directory before preparing trust. Provider keys must match the provider's interpretation of the actual launch directory; do not reuse Gemini's case normalization without evidence.
- Inspection is read-only. Collect each provider's result and distinguish trusted, approval needed, denied, unsupported, and failed. Report success only when all providers required by this setup have effective trust.
- Extend the current confirmation to identify Codex, Claude, and Gemini as applicable and show the directory being approved. An already-trusted result for one provider does not authorize writes for another.
- Bind approval to the inspected canonical directory and provider set. If either changes before preparation, re-inspect and require approval for the changed target. Never infer approval from an existing Module link.
- Refusal and setup failure do not save the new link. On replacement the previous link remains authoritative. Existing browser development behavior remains unchanged; provider config writes belong to the desktop host.

### Codex adapter

- Resolve the active user configuration consistently with the launched Codex process, including its config-home override.
- Merge the canonical project entry's trust level as trusted while preserving other projects and unrelated TOML settings. Preserve an effective explicit untrusted decision and return denial instead of overriding it.
- Use a TOML-preserving facility already available in the repository where possible. Invalid or unsupported configuration must produce a setup error, not replacement with defaults.

### Claude adapter

- Prefer a documented durable trust mechanism verified against the installed provider. If no such mechanism exists, implement the Story's permitted installed-version-specific adapter behind the provider contract.
- Establish and test the exact trust representation, config path overrides, effective denial semantics, and provider write coordination before shipping the adapter. Do not assume a private JSON key based on examples or treat absence as explicit denial.
- Preserve unrelated application state, including authentication, preferences, and project records. Unrecognized state or unsupported versions must return an actionable error without speculative writes.
- A directory for which Claude cannot persist acceptance, including its documented home-directory case, cannot be reported as durably prepared. Explain the limitation and allow another folder selection.

### Write integrity and retry

- Coordinate read-modify-write operations per provider configuration using mechanisms compatible with the installed provider. Re-read under coordination and preserve a denial or unrelated change that appeared after inspection.
- Write a complete replacement to a unique temporary file in the same directory, preserve appropriate file protection, sync it, and atomically replace the destination. Clean up failed temporary writes. Do not assume atomic rename alone prevents lost concurrent updates.
- Refuse malformed data and unsupported symlink/config arrangements without destroying the existing file. Return provider-specific remediation for a busy lock or stale setup state.
- Preflight all providers before writes where possible. There is no cross-provider filesystem transaction: if one approved write succeeds and another fails, report partial setup, leave the Module link unchanged, and make retry idempotent. Do not blindly roll back configuration that a provider may have changed meanwhile.

### Worktrees and launch

- Integrate a separate trust step with task Worktree creation using the actual created directory. Module-folder trust is not proof that an external Worktree is trusted.
- Inspect the existing directory after creation or reuse. Request explicit directory approval before new provider trust writes; unattended operations without approval must report that approval is required.
- A declined or failed trust step must not delete an existing checkout, change its branch, or fabricate a new Worktree identity. Use existing creation/status recovery so retry uses the same checkout and reports trust failure separately from Git creation.
- Do not silently grant trust during agent launch. Keep tmux-hosted interactive launches and their run/session identities. The resident Codex app-server remains read-only for title lookup, as required by the existing ADR.

## Testing Decisions

- Test externally observable behavior through existing seams. Primary coverage is the Studio folder-setup acceptance flow and real installed-provider interactive launches. Reuse existing Rust trust tests for file-integrity cases that cannot be observed reliably through Studio.
- Studio cases cover creation, missing-folder selection, replacement, Gemini already trusted with new Codex/Claude consent, all providers trusted, cancellation, explicit denial, partial failure, retry, and old-link retention. Assert ordering: trust succeeds before the Module link is written.
- Rust provider contract cases cover canonical directories, invalid paths, config-home overrides, unrelated TOML/JSON preservation, effective denial, concurrent changes, busy coordination, failed replacement, and idempotent retry. Shared contract coverage must exercise both new adapters rather than substitute generic success mocks.
- Worktree acceptance covers a separate directory requiring trust, explicit refusal without checkout loss, and retry using the existing checkout.
- Extend the prior installed-Gemini test approach with disposable provider configuration and a bounded interactive PTY launch for Codex and Claude. First demonstrate the trust gate on fresh state, then prepare approved trust and verify the workflow prompt is consumed without the trust dialog. Start a second fresh process to prove durability. Repeat for an external Worktree.
- Claude print mode is not sufficient evidence because it bypasses trust verification. Authentication failure after startup alone is also insufficient evidence of workflow prompt consumption. Record the tested versions and actual interactive transcript evidence; report unavailable credentials as an unfulfilled launch check.
- Do not modify live provider state to run contract tests. Keep test output, databases, and generated provider files isolated and uncommitted.
- Add or update the numbered Studio acceptance cases and run `npm run test:overhaul --workspace @worktracker/studio` before implementation handoff, along with affected Rust tests and installed-provider contracts. This specification-only stage does not claim those checks have run.

## Out of Scope

- Models, effort mappings, profile defaults, and the shared provider interface itself, which belong to CODING-1866.
- New module-creation flows, broad trust of parent directories, silent approval, permission-bypass flags, tool permissions, MCP authentication, or hook approval.
- Terminal renderer changes, new tmux sessions to repair trust, or moving interactive conversation ownership to the Codex app-server.
- Implementation tickets or implementation changes during Spec.

## Further Notes

- The initial assessment observed Codex 0.154.0 and Claude Code 2.1.270 locally. These are observations, not a permanent compatibility guarantee; no interactive launch verification was performed during that assessment.
- [Official OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents project/worktree trusted and untrusted entries.
- [Claude Code security](https://code.claude.com/docs/en/security) documents first-directory trust, print-mode behavior, and the home-directory persistence limitation.
- [Claude directory documentation](https://code.claude.com/docs/en/claude-directory) identifies global application state but does not establish a public writable trust API. The adapter must carry installed-version contract evidence.
- The original Story description retains repository starting points and investigation details. This specification supplies the implementation behavior; CODING-1866 remains the prerequisite for its code contract.
