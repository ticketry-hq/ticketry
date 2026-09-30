# CODING-1866: Shared provider contract

## Problem Statement

Ticketry users can configure and launch an agent whose provider setup is incomplete. Module folder approval currently prepares Gemini trust, while Codex and Claude may still stop at hidden interactive trust prompts. Provider knowledge is spread across catalog provisioning, selection validation, launch materialization, and native folder setup. Adding a provider does not require implementing all of these responsibilities.

## Solution

Require every supported provider to implement one Rust trait covering models, effort compatibility, profiles, directory trust, and launch construction. Route existing application consumers through that contract. A missing responsibility must fail compilation; an unavailable capability must have an explicit, validated result.

This Story establishes the contract and integrates existing behavior. CODING-1864 implements durable Codex and Claude directory trust through it. Reporting those capabilities as unsupported here is not completion of that downstream work.

## User Stories

1. As a maintainer, I want one required provider trait, so that a new provider cannot omit setup responsibilities.
2. As a maintainer, I want all registered providers covered by shared validation, so that an adapter cannot escape checks by remaining inactive.
3. As a user, I want my existing model identifiers preserved, so that saved selections keep working.
4. As a user, I want installation defaults to match provider capabilities, so that new installations offer valid choices.
5. As a user, I want unsupported effort choices rejected, so that launches do not receive incompatible flags.
6. As a user, I want providers without effort support represented explicitly, so that an empty selection is understandable.
7. As a user, I want my registered Codex profiles preserved, so that existing Launch Bindings retain their configuration.
8. As a user, I want profile selections mapped without rewriting my provider configuration, so that customization survives launches.
9. As a user, I want inherited and global defaults resolved consistently, so that manual and workflow launches use the intended choices.
10. As a user, I want catalog reload behavior to be explicit, so that I know whether data comes from persisted settings or provider discovery.
11. As a user, I want trust inspection to leave configuration untouched, so that checking a folder grants no permission.
12. As a user, I want missing approval distinguished from explicit denial, so that Ticketry offers the appropriate next step.
13. As a user, I want every trust write authorized for its actual directory and provider, so that Module approval does not silently trust a separate Worktree.
14. As a user, I want existing provider denial preserved, so that Ticketry does not reverse my security decision.
15. As a user, I want unsupported trust and setup failures reported honestly, so that Ticketry does not claim a folder is prepared when it is not.
16. As a user, I want existing Gemini trust preparation preserved, so that this architecture change does not break folder setup.
17. As a user, I want folder setup to complete before a replacement Module link is saved, so that failure retains the previous link.
18. As a user, I want launch and resume behavior preserved, so that agent conversations and durable terminal sessions keep their identities.
19. As a maintainer, I want focused private provider implementations, so that each provider can change without spreading branching logic through application orchestration.
20. As the implementer of CODING-1864, I want explicit trust inspection and approved preparation operations, so that durable adapters can be added without another provider abstraction.

## Implementation Decisions

### Contract ownership and dependency direction

- Evolve the existing Provider identity, provider lookup, and ProviderContract metadata into one required trait with concrete private implementations for Claude, Codex, Gemini, and Agy. Retain useful metadata as part of this contract, including composer markers, invocation prefixes, hook events, timeout units, resume, MCP, and required-skill capabilities.
- Move provider-owned definitions and implementation into one focused foundation-tier provider crate. Settings needs catalog capabilities below its config tier, while launch needs the same implementations below execution. Do not make Settings depend on launch or put provider behavior into generated entities. Move existing code rather than retaining a second registry.
- Keep the single provider enumeration/lookup exhaustive. Required trait responsibilities have no success-returning defaults. Explicit unsupported implementations satisfy the Rust contract but must also pass capability-specific shared checks.
- Keep provider input/output values independent of database connections, GraphQL types, Work Item policy, and execution services. Reuse or move existing provider option and launch value types where possible. Settings retains persistence; launch retains policy resolution, authority validation, tracing, and materialization orchestration.
- Export approved types only from crate roots. Keep implementation modules private, respect dependency tiers, and update the existing public API boundary contract and export fixture for deliberate changes. Any compatibility re-export must refer to the same implementation.

### Models, efforts, and profiles

- Each provider supplies installation catalog definitions, declared defaults, effort compatibility, profile capability/defaults, and explicit catalog refresh behavior. Preserve the current database-backed catalog as the authority for persisted selections and custom rows.
- The inspected implementation has static installation seeds and database reloads, with no provider model-discovery refresh path found. Declare that behavior explicitly. This Story does not add network discovery, polling, a refresh scheduler, or use the resident Codex app-server for model discovery.
- Preserve current seed identifiers: Claude sonnet, opus, haiku, and fable; Codex gpt-5.4; Gemini gemini-3.1-pro-preview; Agy vendor/model. Preserve Claude effort values low, medium, high, xhigh, max and Codex minimal, low, medium, high, xhigh. Gemini and Agy explicitly have no effort support. These are repository defaults, not a claim about the complete external provider catalogs.
- Preserve Agy's inactive installation default and exclusion from Settings activation controls. Registration and capability validation must still include it. Derive adapter/catalog drift checks and configurable-provider metadata from the same provider contract instead of repeated slug lists.
- Keep model/effort relationships and persisted identifiers intact. Installation provisioning consumes the contract; ordinary reads or validation must not reseed an existing installation or replace customized rows. Validate defaults against the applicable catalog and preserve current omitted/default behavior without inventing a preferred model or effort.
- Only Codex currently supports named launch profiles. Existing profile registration defaults to an empty list; expose that explicitly rather than inventing bundled profile names. Preserve normalization, registered names, and the rule that a profile cannot be combined with explicit model or reasoning overrides.
- Resolve Launch Binding, Module, and global-default precedence through existing policy code. Delegate provider capability and option validation to the shared contract. Do not change precedence during this migration.
- Map choices into provider argv/settings through provider implementations. Preserve Claude effort arguments, Codex reasoning configuration overrides and profile selection, and explicit rejection of unsupported choices. No launch should overwrite a user's profile definition or unrelated provider settings.

### Directory trust

- Require distinct inspection and approved-preparation operations. Inspection accepts the actual validated working directory and provider configuration context, performs no writes, and distinguishes already trusted, approval needed, denied, unsupported, and failure. Preparation returns prepared or already trusted only when effective trust has been established.
- Bind approval to the provider and canonical directory. Preparation without matching explicit approval cannot write. Recheck effective denial before mutation; a change of target requires fresh inspection and approval. Keep failures attributable to the provider and operation.
- Move the existing Gemini implementation behind the contract, preserving canonical-directory validation, environment-based trust-file resolution, explicit denial, locking, reread before write, and atomic replacement behavior. Separate the current combined Refused result into missing approval and effective denial.
- Codex, Claude, and Agy explicitly report durable trust unsupported at this stage. Do not infer trust from permission flags, existing Module links, successful process startup, or absence of an implementation.
- Route native folder inspection/preparation through the contract while retaining the existing Gemini setup scope until CODING-1864 extends it. Unsupported providers must not be counted as prepared. This migration must not make currently working Gemini-only Module setup fail merely because the remaining durable adapters are pending.
- Preserve the main-window restriction, existing confirmation authority, browser-development behavior, and trust-before-Module-link ordering. Show denial without asking the user to approve an overwrite; missing approval remains the confirmation path. Cancellation and setup failure retain the previous Module link.
- Represent an actual Worktree directory independently of the Module directory. This Story supplies the reusable trust contract and correct directory inputs; CODING-1864 owns new Worktree consent and durable Codex/Claude preparation. Launch itself must not grant trust silently.

### Launch and consumers

- Provider implementations construct invocation arguments and provider-specific runtime configuration from validated selections, launch kind, session identity, executable, and actual working directory. Keep executable and execution-authority validation in existing orchestration before effects occur.
- Migrate provider branching in launch argv/settings construction, catalog provisioning and drift validation, profile/capability checks, and native trust dispatch. Include workflow/MCP option validation where it repeats the same provider rules. Shared plumbing may remain shared; provider facts must come from the one contract.
- Preserve fresh-launch and resume semantics, including existing differences in which overrides apply on resume. Preserve hooks, timeout units, MCP stdio bridge and socket configuration, runtime environment, required skills, and composer detection.
- Retain tmux ownership of interactive conversations and durable session identities. The resident Codex app-server remains limited to read-only thread-title lookup under the existing ADR. No renderer changes are part of this work.
- Retain existing persistence and generated GraphQL contracts. No schema change is expected merely to introduce the trait. If a database contract change proves necessary, use migrations and generated Seaography contracts under repository rules, not a replacement CRUD API. Apollo remains the frontend state owner.

## Testing Decisions

- Test observable contract behavior through existing catalog service, launch materialization, and native folder-setup acceptance boundaries. Avoid tests tied to private module layout or trait-dispatch mechanics. The Story already requires these boundaries; retain them rather than introduce a separate test framework.
- Run one shared provider contract suite over every registered provider, including inactive Agy. Validate unique identities, catalog/default consistency, supported and absent efforts, model compatibility, profile mapping and conflicts, explicit trust capability handling, and launch construction. Ensure the provider inventory used by the suite and application lookup cannot drift.
- Extend existing provider catalog integration coverage for installation defaults, persisted custom rows, activation, invalid defaults, registered profiles, and reload without destructive reseeding. Assert absence of an invented discovery or profile-writing side effect.
- Reuse launch golden and MCP materialization tests for fresh launches and resumes across all four providers. Check actual working directory, provider flags/settings, hooks, profile behavior, invalid choices, and session identity preservation. Retain workflow profile and interactive launch authority tests for default precedence.
- Exercise read-only trust inspection with isolated provider files. Compare configuration before and after trusted, missing-approval, denied, unsupported, and malformed-state inspection. Preparation tests establish that no approval or mismatched directory/provider causes no writes and that denial remains intact.
- Retain provider-specific Gemini tests for environment overrides, canonical paths, denial, locking/concurrent rereads, failed replacement, and idempotent preparation. Test unsupported adapters through their real contract implementations, not a generic success mock.
- Update Studio acceptance cases for the visible distinction between approval needed, denial, unsupported capability, and setup failure where exposed by the migrated flow. Cover confirmation, cancellation, trust-before-save ordering, and replacement retaining its prior Module link. Preserve browser-development behavior.
- Update the numbered overhaul gate and run npm run test:overhaul --workspace @worktracker/studio before implementation handoff, alongside affected Rust catalog, launch, trust, and public API boundary tests. Record actual results and unavailable checks.
- Real installed Codex/Claude interactive launches proving durable trust remain acceptance requirements of CODING-1864 and its existing children. Passing unsupported-capability tests here cannot satisfy those checks. All provider test state must remain isolated from live configuration.

## Out of Scope

- Durable Codex and Claude trust adapters, their provider-version investigations, new multi-provider consent orchestration, and new Worktree trust flows owned by CODING-1864 and its existing Implementation children.
- New providers, activating Agy, new default profile names, updated model identifiers, changed effort mappings, or changed launch-policy precedence.
- New model discovery services, polling, dynamic plugin loading, parallel registries, mirrored state stores, or a product REST API.
- Permission-bypass changes, terminal-renderer changes, or replacement tmux/run identities.
- Implementation tickets or implementation changes during Spec.

## Further Notes

CODING-1864 and CODING-1878 already depend on CODING-1866. Preserve those edges. Their existing approved breakdown continues with CODING-1879 for Claude and CODING-1880 for Worktrees.

The original Story retains the repository investigation and file inventory. Its linked CODING-1864 specification contains the consent, denial, concurrent-write, atomic-write, worktree, and real interactive launch requirements for downstream implementation.

This specification records the current inspected behavior and the agreed architecture outcome. It does not claim implementation or passing tests. The working tree already contains unrelated changes; implementation must preserve them.
