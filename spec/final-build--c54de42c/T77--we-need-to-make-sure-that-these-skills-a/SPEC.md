# Install the Complete Workflow Skill Set

## Problem Statement

Ticketry's workflow prompts depend on six upstream engineering skills:
`grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `tdd`, and
`code-review`. The packaged, pinned catalog currently selects only the three
refinement skills. As a result, Ticketry cannot make the same startup and launch
guarantees for the implementation and review skills that it already makes for
the refinement chain.

A workflow stage must not start an agent and merely hope that its skill happens
to exist in a provider's user configuration. Ticketry must own a verified copy,
install it safely for every supported provider, resolve its dependency closure,
and fail before launch when the expected skill is missing, modified,
conflicting, or unsupported.

## Solution

Expand Ticketry's immutable, pinned `mattpocock/skills` catalog so it contains
the complete dependency closure of the six requested skills at upstream
revision `ed37663cc5fbef691ddfecd080dff42f7e7e350d`.

The explicit maintainer refresh remains the only networked acquisition step. It
downloads the selected packages, verifies the installer output against the
exact upstream revision, records package metadata and digests, and replaces the
vendored snapshot. Normal desktop startup remains offline. At startup, Ticketry
installs or verifies the complete packaged catalog in each supported provider's
native persistent skill directory while preserving the existing ownership and
collision protections.

Bind one primary skill to each active workflow stage:

1. Grill requires `grill-with-docs`.
2. Spec requires `to-spec`.
3. Tickets requires `to-tickets`.
4. Implement requires `implement`.
5. Review requires `code-review`.

The `implement` package's pinned dependency closure supplies `tdd` and any other
skill it invokes. Dependencies are therefore guaranteed to be installed and
available when Implement starts without assigning multiple primary skills to a
single workflow stage.

## User Stories

1. As a Ticketry user, I want every workflow stage to start with its expected
   skill available, so that agent behavior is consistent across providers and
   machines.
2. As a Ticketry user, I want Grill to require `grill-with-docs`, so that ideas
   are refined using the intended requirements workflow.
3. As a Ticketry user, I want Spec to require `to-spec`, so that agreed
   requirements become a consistent specification.
4. As a Ticketry user, I want Tickets to require `to-tickets`, so that an
   approved specification becomes scoped Implementation children with explicit
   dependencies.
5. As a Ticketry user, I want Implement to require `implement`, so that an
   implementation agent follows the intended build workflow.
6. As a Ticketry user, I want `tdd` available when Implement starts, so that the
   implementation skill can use its required test-first workflow at agreed
   seams.
7. As a Ticketry user, I want Review to require `code-review`, so that review
   launches use the intended two-axis review workflow.
8. As a Ticketry user, I want transitive skill dependencies installed
   automatically, so that I do not need to understand or manually reproduce the
   upstream dependency graph.
9. As a Ticketry user, I want startup to work without network access, so that
   launching the desktop application does not depend on GitHub or a package
   registry being available.
10. As a Ticketry user, I want startup to reject a conflicting user-owned skill
    rather than overwrite it, so that Ticketry cannot silently destroy my local
    customization.
11. As a Ticketry user, I want Ticketry-managed skills upgraded safely when the
    packaged snapshot changes, so that an application update provides the
    matching workflow behavior.
12. As a Ticketry user, I want a modified Ticketry-managed skill detected before
    agent launch, so that the launched workflow cannot silently diverge from the
    reviewed version.
13. As a maintainer, I want all skill content pinned to one exact upstream
    revision, so that a release is reproducible and reviewable.
14. As a maintainer, I want acquisition metadata, dependency relationships,
    required tools, and content digests recorded in the lock, so that catalog
    integrity can be verified without the network.
15. As a maintainer, I want the refresh operation to verify installed bytes
    against the checked-out upstream source, so that the package installer
    cannot introduce unreviewed differences.
16. As a maintainer, I want the selected package set and its transitive closure
    validated together, so that a referenced dependency cannot be omitted from
    the shipped application.
17. As a maintainer, I want the reviewed workflow defaults to remain the single
    source of truth for stage requirements, so that seeding, validation, and
    launch behavior cannot drift apart.
18. As a maintainer, I want every supported provider to use its normal
    persistent skill-discovery directory, so that no provider-specific
    temporary overlay becomes a second installation model.
19. As a maintainer, I want launch preflight to resolve only the skill closure
    needed by the current stage, so that stage requirements are explicit and
    diagnostics identify the relevant dependency.
20. As a maintainer, I want installed release acceptance to check the complete
    workflow skill set, so that packaging omissions are caught before release.
21. As a maintainer, I want the existing repair command to restore the expanded
    catalog, so that operators retain one documented recovery path.
22. As a maintainer, I want provider version and MCP-tool requirements enforced
    for the expanded closure, so that a skill is not considered available when
    its execution prerequisites are absent.

## Implementation Decisions

- Keep the existing controlled snapshot architecture. Do not add runtime
  downloads or a second skill installation mechanism.
- Pin acquisition to upstream revision
  `ed37663cc5fbef691ddfecd080dff42f7e7e350d`.
- Treat all six requested skills as application-owned workflow capabilities.
  Package every transitive dependency required by those selected capabilities.
- Preserve the catalog's byte-level integrity checks, canonical-name checks,
  attribution, provider support matrix, dependency-closure validation, and MCP
  tool declarations.
- Preserve startup installation into the native persistent skill roots for
  Claude, Codex, Agy, and Gemini.
- Preserve idempotent installation, the Ticketry ownership manifest, safe
  replacement of previously managed copies, and refusal to overwrite
  user-owned or modified conflicts.
- A workflow stage has one primary pinned skill. The canonical mapping is
  Grill/`grill-with-docs`, Spec/`to-spec`, Tickets/`to-tickets`,
  Implement/`implement`, and Review/`code-review`.
- `tdd` is guaranteed for Implement through the locked dependency closure of
  `implement`; it is not a second primary workflow-stage binding.
- The reviewed defaults artifact remains authoritative for per-stage required
  skills. Backend defaults, workflow seeding, migrations, validators, and
  release artifacts must derive from or agree with that artifact.
- Launch preflight must resolve the current stage's complete dependency closure
  and reject unknown packages, missing tools, unsupported provider versions,
  missing installations, modified installations, and canonical-name
  collisions before durable agent-run or terminal state is created.
- Normal runtime remains fully offline with respect to skill content. Only the
  explicit maintainer refresh may invoke the upstream installer or access the
  upstream repository.
- No workflow states, transitions, issue types, or automation gates are added
  or renamed by this work.

## Testing Decisions

- Tests must verify behavior through existing public seams rather than internal
  helper details. Expected package names, dependency closure, workflow
  requirements, installed contents, and launch outcomes should be asserted from
  independent locked or reviewed values.
- Catalog tests will verify that the six selected capabilities and their exact
  transitive closure are present, correctly classified, digest-valid, and
  reachable.
- Installation tests will exercise the existing provider installation API
  across supported providers, including first install, idempotent reinstall,
  managed upgrade, missing package repair, modified managed content, and
  user-owned collision behavior.
- Launch-preflight tests will exercise required-skill resolution for every
  active stage. They will verify that Implement resolves `implement` plus its
  dependency closure and that Review resolves `code-review` plus its dependency
  closure.
- Workflow-default tests will verify the canonical one-stage/one-primary-skill
  mapping and its propagation into seeded launch bindings.
- Failure-path tests will continue to prove that catalog, installation,
  provider, collision, and required-tool failures occur before durable agent or
  terminal records are created.
- Installed-artifact acceptance will verify that a packaged desktop startup
  exposes the complete skill catalog expected by the workflow, not only the
  original refinement subset.
- Existing catalog, installation, required-skill launch, reviewed-default
  validation, seeding, migration, and packaging acceptance suites are the prior
  art and preferred test seams. New production seams are not required.

## Out of Scope

- Downloading skill content during normal desktop startup or agent launch.
- Allowing users to select arbitrary upstream repositories, branches, commits,
  or skills.
- Automatically overwriting user-owned or locally modified skills.
- Changing provider-native skill directory conventions.
- Adding a second primary required skill to a workflow stage.
- Redesigning the Grill, Spec, Tickets, Implement, or Review workflows.
- Changing workflow transitions, auto-start policy, implementation kickoff, or
  review acceptance behavior.
- Upgrading beyond the pinned upstream revision named in this specification.
- Implementing a general-purpose plugin or skill marketplace.

## Further Notes

The distinction between acquisition and startup installation is intentional.
Maintainers acquire and review upstream content ahead of release; Ticketry
installs and verifies those packaged bytes at startup. This makes workflow
dependencies predictable without making application startup dependent on the
network.

The source repository's canonical workflow state spelling is `Implement`.
