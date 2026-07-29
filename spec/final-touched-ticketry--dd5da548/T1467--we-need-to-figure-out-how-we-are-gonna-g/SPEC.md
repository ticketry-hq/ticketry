# T1467 — Provision required workflow skills for launched coding agents

Status: Refined
Story: CODIN-1467
Date: 2026-07-28

## Summary

Ticketry will package a pinned snapshot of the workflow skills installed from
`mattpocock/skills` by:

```sh
npx skills@latest add mattpocock/skills
```

A launch binding will declare the exact upstream skills it requires, and the
launch path will expose that packaged snapshot to the selected provider for
that invocation only. Launches will not download skills, install into user
directories, or write provider configuration into the target repository.

The initial required set is `grill-with-docs`, `to-spec`, and `to-tickets`,
including the upstream packages those skills invoke. Ticketry does not fork,
rewrite, or claim ownership of their instructions. The canonical Refinement
prompt is corrected from the nonexistent `grill-me-with-docs` name to the
upstream `grill-with-docs` name.

## Problem

The default Idea and Refinement launch prompts explicitly invoke workflow
skills, but the launch path currently supplies only prompt text, lifecycle
hooks, and (for Claude, Codex, and Agy) WorkTracker MCP configuration. Skill
discovery is left to each provider's user- or repository-level configuration.
Consequently, a fresh Ticketry installation can launch an agent that is
instructed to use a skill it cannot discover. Gemini also currently lacks the
WorkTracker MCP injection needed by the ticket-writing skills.

This violates the workflow prompt contract and makes behavior depend on
unrelated global configuration.

## Goals

1. A fresh packaged Ticketry installation can launch Claude, Codex, Agy, or
   Gemini from a binding that requires a Ticketry workflow skill.
2. Every required skill is the pinned `mattpocock/skills` snapshot shipped with
   the running Ticketry build.
3. Skill availability is scoped to one invocation and survives fully offline.
4. Ticketry does not overwrite, install into, or mutate user/provider config or
   repository-owned skill directories.
5. A launch fails before an `AgentRun` or tmux session is created when its
   requirements cannot be satisfied.
6. The prompt, declared requirements, packaged catalog, provider injection, and
   WorkTracker tool dependency are testable as one contract.

## Non-goals

- A general-purpose skill marketplace or user-facing skill installer.
- Automatic network updates of skills.
- Provisioning arbitrary skill sources from custom user-authored prompts.
- Replacing provider-native skill activation with permanent prompt expansion.
- Migrating or deleting a user's existing skills.
- Making Ticketry the owner of provider authentication or general settings.

## Requirements

### R1 — Explicit launch-binding contract

`LaunchBinding` gains an ordered `required_skills` value containing canonical
identifiers from Ticketry's pinned upstream snapshot. The field is exposed by the workflow schemas,
services, and configuration APIs and participates in workflow revision
updates.

Requirements are not inferred by regex from prompt prose. A binding may mention
optional or user-owned skills in prose, but Ticketry guarantees only identifiers
declared in `required_skills`.

Validation rejects:

- identifiers absent from the pinned upstream snapshot;
- duplicate identifiers;
- a required skill without a non-empty prompt;
- provider/binding combinations that cannot expose every requirement.

Seed data declares:

- Idea: `to-spec`, `to-tickets`
- Refinement: `grill-with-docs`, `to-spec`, `to-tickets`

The seed/migration also normalizes the Refinement prompt to the canonical
`grill-with-docs` spelling. Existing user-edited prompts are not rewritten.

### R2 — Pinned upstream snapshot

The skill content comes from
[`mattpocock/skills`](https://github.com/mattpocock/skills), acquired through
`npx skills@latest add mattpocock/skills` in a controlled maintainer refresh
step. Ticketry checks in or release-generates the resulting required packages
under a backend resource directory so packaged launches do not run `npx` or
need network access.

A lock manifest records:

- the `skills` CLI version used for acquisition;
- upstream repository URL and exact commit SHA;
- selected package names, including transitive skill dependencies used by the
  required set;
- installed package-relative paths;
- content digest;
- required Ticketry MCP tools;
- supported providers and the minimum tested provider version/mechanism.

Refreshing the snapshot is an explicit maintainer action that re-runs the
installer, reviews the upstream diff and license/attribution, updates the lock,
and runs the provider matrix. `@latest` is allowed only in that refresh
workflow; released builds consume the resulting locked files. The catalog is
immutable at runtime. The backend validates its manifest and digests before
launch. Development and packaged builds resolve the same snapshot through one
resource-locator abstraction.

The PyInstaller sidecar and Tauri packaging include the complete catalog.
No runtime download or cache warm-up is required.

### R3 — Invocation-scoped provider exposure

The adapter contract is extended from lifecycle/MCP injection to a launch
augmentation result containing final argv, environment additions, and
run-scoped temporary artifacts. The common launch service resolves and
validates required packages before persistence, then asks the selected adapter
to expose only those packages.

Provider implementations use supported native discovery without writing the
user's config:

| Provider | Invocation-scoped exposure |
| --- | --- |
| Claude | Load the packaged skills-only plugin with repeatable `--plugin-dir`, or an equivalent documented session-only directory flag. |
| Codex | Use a run-scoped `HOME` containing the packaged `.agents/skills` closure while retaining the user's original `CODEX_HOME` for authentication/config/state; restore the original home for agent shell tools through invocation config. Required packages whose upstream Codex metadata is explicit-only are made invocation-eligible only in this temporary provider copy because CLI argv prompts cannot carry composer `$skill` mention metadata. |
| Agy | Add a run-scoped skills root using the provider's workspace/plugin overlay mechanism (`--add-dir` or a validated session-only plugin route), while retaining the relocated settings file for hooks and MCP. |
| Gemini | Use a run-scoped Gemini home/extension overlay containing only Ticketry's skills, while preserving authentication through provider-supported state resolution; combine it with the existing relocated system-settings layer. |

Implementation must verify the exact mechanism against the minimum supported
CLI version and add adapter-level contract tests. If a provider version cannot
support a non-mutating invocation overlay, that version is unsupported for a
required-skill launch and the preflight fails.

Temporary overlays are created below Ticketry's run-specific temporary area,
named by `agent_run_id`, with restrictive permissions. They contain no copied
credentials and are removed when a launch fails or its terminal session is
terminated/reconciled. Immutable packaged skill directories may be referenced
directly where the provider supports it.

### R4 — Deterministic collision policy

The required names in the pinned upstream snapshot are reserved for Ticketry
workflow bindings.
Before launch, the provider preflight scans the provider-visible repository and
user skill metadata for duplicate reserved names.

- No collision: expose the packaged version.
- Same name and identical locked upstream digest: treat as already satisfied.
- Same name with different or unverifiable content: fail the launch.

Ticketry never overwrites or silently shadows the user's package. The error
identifies the name and conflicting path but does not expose skill contents or
credentials.

For providers whose native precedence cannot make the selected package
unambiguous, collision detection is mandatory even when their normal behavior
would choose one source.

### R5 — Tool dependency and Gemini parity

Catalog entries declare required MCP tools. Preflight verifies that the
selected adapter will expose those tools in the same invocation.

Gemini must receive the authenticated `worktracker-agent` MCP server through
the existing run-scoped system settings payload, matching Agy's non-mutating
pattern. A required workflow launch is rejected if WorkTracker MCP
authorization or configuration cannot be produced.

This ticket does not add unrelated Gemini MCP capabilities; it closes only the
parity required by the packaged workflow skills.

### R6 — Failure behavior

Skill resolution, manifest verification, collision detection, provider
capability checks, temporary-artifact creation, and required MCP configuration
all occur before saving `AgentRun` and before `tmux.create_session`.

Failures surface a structured `required_skill_unavailable` launch error with:

- provider;
- skill identifier;
- stable reason code (`unknown`, `catalog_invalid`, `provider_unsupported`,
  `collision`, `tool_unavailable`, or `overlay_failed`);
- a concise remediation message.

There is no fallback to a similarly named global skill, prompt-only execution,
another provider, or a network fetch. Automated launches record the failed
attempt through their existing failure path and do not roll back the workflow
state transition.

### R7 — Prompt envelope

After successful preflight, the application-owned launch envelope adds a small
factual block listing the resolved required skill names and pinned upstream
revision and states that Ticketry supplied them for this invocation. It does
not inline or rewrite the upstream skill body or alter user-authored workflow
guidance.

Seeded prompts use canonical names and provider-neutral wording. They may show
provider invocation forms such as `$name` or `/name`, but the binding metadata,
not the punctuation in the prompt, determines provisioning.

### R8 — Verification

Automated coverage includes:

- upstream lock schema, commit, digest, transitive dependency, attribution, and
  unique-name validation;
- seed and migration behavior without rewriting edited bindings;
- API round trips and launch-binding validation for `required_skills`;
- each adapter's exact argv/environment/overlay output;
- collision behavior for identical and different content;
- no writes to user homes or repository skill directories;
- preflight failure leaves no `AgentRun`, tmux session, or temp overlay;
- Gemini receives authenticated WorkTracker MCP configuration;
- development resource resolution and built-sidecar resource resolution;
- an installed-artifact smoke matrix for Claude, Codex, Agy, and Gemini that
  confirms the required names are discoverable without network access.

## Architecture

```text
LaunchBinding(required_skills)
          |
          v
RequiredSkillResolver ----> pinned upstream snapshot + digest verification
          |                           |
          |                           v
          +----> provider-visible collision scan
          |
          +----> MCP/tool dependency preflight
          |
          v
AgentAdapter.augment_launch(...)
          |
          +----> argv / env / temporary overlay
          |
          v
persist AgentRun ----> create tmux session
```

The resolver is application-owned and provider-neutral. Adapters own only the
last-mile representation accepted by their CLI. Packaging owns resource
availability. Prompt construction owns only the factual resolved-skills block.

## File change map

Expected primary surfaces:

- `backend/worktracker/models/launch_binding.py`
- `backend/worktracker/schemas.py`
- `backend/worktracker/services/launch_bindings.py`
- `backend/worktracker/services/scoped_workflows.py`
- `backend/worktracker/launch_seeds.py`
- a new WorkTracker migration after the current head
- `backend/apps/terminals/prompt_builder.py`
- `backend/apps/terminals/launch.py`
- `backend/apps/terminals/agents/registry.py`
- `backend/apps/terminals/agents/injectors/{claude,codex,agy,gemini}.py`
- new `backend/apps/terminals/agents/skills/` upstream snapshot, lock, and
  resolver resources
- `backend/packaging/muxed-backend.spec`
- `backend/packaging/test-built-sidecar.sh`
- relevant WorkTracker, terminal adapter, launch, and packaging tests

`studio/src-tauri/tauri.conf.json` needs a change only if the catalog cannot be
embedded in the existing backend sidecar. The preferred design embeds it in
the sidecar, avoiding a second desktop resource path.

## Implementation sequence

1. Acquire, lock, attribute, and package the required
   `mattpocock/skills` snapshot.
2. Add the `required_skills` launch-binding contract and migrate seed data.
3. Add preflight resolution plus provider-specific invocation overlays,
   including Gemini WorkTracker MCP parity.
4. Add packaged/offline acceptance coverage and run-overlay cleanup.

Steps 1 and 2 establish the inputs. Step 3 depends on both. Step 4 depends on
the completed launch path.

## Acceptance criteria

- On a fresh installation with no user skills, each supported provider can
  launch the seeded Refinement workflow and discover all three canonical
  Ticketry skills.
- The same test succeeds with network access disabled.
- User and repository provider configuration is byte-for-byte unchanged after
  launch and termination.
- A conflicting user skill causes a structured pre-launch error and is not
  overwritten or silently used.
- A corrupt/missing packaged skill, unsupported provider version, or missing
  WorkTracker MCP dependency fails before any durable run or tmux session is
  created.
- The story's seeded prompt, binding metadata, packaged catalog, and provider
  exposure agree on canonical names.
- Packaged desktop acceptance verifies the resources from the built sidecar,
  not only the source checkout.

## Decisions and rationale

- **Acquire only during a controlled refresh, bundle for runtime:** uses the
  requested upstream skills while remaining deterministic and offline at
  launch time.
- **Per invocation, not user install:** preserves user ownership and prevents
  cross-project side effects.
- **Explicit binding metadata, not prompt parsing:** prompts are opaque prose;
  requirements need validation and migration semantics.
- **Fail on collision, do not overwrite or silently shadow:** deterministic
  behavior without taking ownership of unrelated configuration.
- **Fail closed before persistence:** a running agent missing required workflow
  instructions or tools cannot safely complete the bound stage.
- **One unmodified upstream Agent Skills snapshot, provider-specific
  exposure:** keeps Matt Pocock's workflow content identical while isolating
  CLI-specific mechanics in adapters.
