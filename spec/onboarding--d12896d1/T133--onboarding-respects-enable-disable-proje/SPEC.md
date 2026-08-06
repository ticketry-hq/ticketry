# Onboarding respects enabled and disabled Projects

## Problem Statement

Ticketry's first-run onboarding currently asks every user to create a project, even when the Projects surface is disabled for the installation. That exposes a concept the installation intentionally hides, duplicates the default-project bootstrap that has already run, and can hand the guided tour a missing project selection that causes the tour to stop silently.

The problem extends beyond the welcome screen. A module's local folder is currently represented as an opaque per-profile dictionary and can be absent while the module is selected or created. Modules created through agents and MCP do not pass through the Studio creation forms, so later work can reach terminal, worktree, prompt, or document behavior without the local path those behaviors require. Users need onboarding and ordinary module interactions to enforce one consistent rule: the active profile must have a module folder before the module can be worked on.

## Solution

When Projects is disabled, first-run onboarding presents provider setup as the entire welcome screen. Continuing uses the project already selected during bootstrap; if that invariant is not satisfied, Ticketry resolves and selects the default Coding project, creating it only as a fallback. The guided tour starts at module creation only after a non-null project has been selected. Resolution errors remain visible and retryable on the provider pane.

When Projects is enabled, the existing two-pane welcome flow remains: provider setup continues to first-project creation and then into the guided tour. The provider action says `Continue` in this mode and `Get started` when Projects is disabled.

Ticketry also makes the module folder a first-class local link between a module and a profile. New and existing module-creation surfaces collect the module name and folder together and do not advance until both the module and its folder link exist. Selecting a module created outside those surfaces prompts for its folder before changing the selection. Local profile settings migrate the legacy folder dictionary to an explicit list of module links while keeping machine-local paths out of planning data.

## User Stories

1. As a first-time user on an installation without Projects, I want to configure my agent providers without being asked to create a project, so that onboarding matches the product surface available to me.
2. As a first-time user on an installation without Projects, I want the provider pane to be the whole welcome screen, so that no hidden project step flashes or becomes reachable.
3. As a first-time user on an installation without Projects, I want the primary provider action to say `Get started`, so that its result is clear.
4. As a first-time user on an installation with Projects, I want the provider action to say `Continue`, so that I understand another welcome step follows.
5. As a first-time user on an installation with Projects, I want to retain the first-project form, so that I can name and key my first independently editable project.
6. As a user continuing onboarding without Projects, I want Ticketry to reuse the project selected during bootstrap, so that it does not create redundant projects.
7. As a user continuing onboarding without Projects when no project is selected, I want Ticketry to resolve and select the Coding project, so that the guided tour always has a valid project context.
8. As a user whose installation has no resolvable default project yet, I want Ticketry to create Coding as a fallback, so that first use can proceed without manual project setup.
9. As a user whose default-project resolution fails, I want an inline error on the provider pane, so that I understand why onboarding did not advance.
10. As a user whose default-project resolution fails transiently, I want the action to remain retryable, so that I can recover without reloading or losing provider choices.
11. As a user starting the guided tour without Projects, I want it to open on module creation, so that the first coach mark targets a surface I can use.
12. As a user starting the guided tour with Projects, I want it to retain the project-oriented opening step, so that the tour follows the project I just created.
13. As a user skipping onboarding in either feature mode, I want the existing empty-provider acknowledgement behavior to remain unchanged, so that I can enter Ticketry without completing setup.
14. As a user creating my first module during the guided tour, I want to enter its name and choose its module folder in one form, so that the module is ready to work on when the step completes.
15. As a user creating a module from the normal Studio surface, I want to enter its name and choose its module folder together, so that ordinary creation enforces the same rule as onboarding.
16. As a user creating a module through project state behavior, I want its folder link to be part of the creation flow, so that no Studio creation route produces a pathless module.
17. As a user filling out a module-creation form, I want `Create module` disabled until both name and folder are present, so that I cannot submit incomplete local setup.
18. As a user whose module was created but whose folder link failed to save, I want the error surfaced without advancing, so that the failure is not mistaken for completion.
19. As a user retrying a failed folder link, I want Ticketry to reuse the module already created, so that retries do not create duplicate modules.
20. As a user in the guided tour, I want folder collection inside the module coach mark rather than in a stacked modal, so that the step remains coherent and visibly unfinished until linking succeeds.
21. As a user selecting a module created by an agent or MCP, I want Ticketry to ask for its module folder when my active profile has no link, so that I cannot enter a module that local tools cannot use.
22. As a user cancelling that folder prompt, I want my previous module selection preserved, so that cancellation does not leave the workspace in a pathless module.
23. As a user completing that folder prompt, I want module selection to continue only after the link is stored, so that terminal, worktree, prompt, and document behavior receives a valid local path.
24. As a user with existing local settings, I want my legacy module-folder mappings migrated automatically, so that upgrading Ticketry preserves all configured paths.
25. As a user with multiple local profiles, I want each module folder to remain scoped to its profile, so that the same module can resolve to a different machine-local path in each profile.
26. As a user with recent profile and module history, I want migration to preserve positional profile selection and recency data, so that the settings reshape does not alter my active context.
27. As a user working across machines or workspaces, I want module paths to remain local settings rather than planning data, so that machine-specific filesystem details never synchronize through the tracker.
28. As a maintainer, I want the default project name and identifiers defined once and shared by bootstrap and onboarding, so that both flows resolve the same project.
29. As a maintainer, I want every consumer of a module folder to read the first-class link representation, so that terminal sessions, prompts, agent prompts, worktrees, and documents behave consistently after migration.
30. As a maintainer, I want the first-class module-folder decision recorded in an ADR and the domain glossary, so that the local-storage and referential-integrity trade-off remains understandable.

## Implementation Decisions

* The installation's Projects feature flag controls the welcome-screen shape. Disabled means the project pane is neither rendered nor reachable; enabled preserves the existing two-pane provider-and-project flow.
* Provider setup remains presentation-only with respect to the feature flag. Its parent supplies a `continueLabel`; the provider component does not read installation configuration directly.
* Continuing with Projects disabled first persists the provider catalog, then requires a selected project before starting the guided tour. The bootstrap-selected project is reused whenever present.
* Default-project behavior is centralized behind `resolveDefaultProject()`, with shared `DEFAULT_PROJECT_KEY` and `LEGACY_PROJECT_KEY` constants. Bootstrap and onboarding use that same resolver rather than maintaining separate copies.
* The canonical fallback project is named `Coding` and keyed `CDN`. Resolution prefers `CDN`, accepts the legacy `CODING` key, and creates only when neither project exists.
* A default-project failure is shown inline on the provider pane. The welcome screen remains mounted and retryable, and the tour never starts with a null project ID.
* Skip behavior is unchanged in both feature modes: Ticketry stores the empty provider catalog and acknowledges onboarding without starting the tour.
* The tour's existing feature-aware opening-step decision remains authoritative: Projects-enabled tours retain the project step; Projects-disabled tours begin at module creation.
* A module folder is modeled as a link owned by local profile settings. Each link carries an unvalidated module ID string and a local filesystem path and is scoped by the profile containing it.
* The persisted profile field becomes `module_links`, represented as a list of objects with `module_id` and `path`. The legacy `module_folders` dictionary is removed from the current serialized contract.
* Profiles do not gain durable IDs. Existing profile array position, current/recent profile index behavior, recent project, and recent module state remain unchanged.
* Loading legacy settings performs a one-time migration from every module-ID/path dictionary entry to an equivalent module-link entry. Saving emits only the current `module_links` representation, preserves unrelated profile fields, and continues to use the existing atomic settings-file write.
* Module links remain in local settings and are not added to the planning database or planning APIs. This preserves the boundary that keeps machine-local paths from synchronizing with tracker data.
* Because the module ID is not protected by a planning-database foreign key, Studio enforces the operational invariant that a module cannot be worked on until the active profile contains its folder link.
* All existing module-folder consumers move to the link representation: launch prompt construction, terminal session creation, agent prompt construction, worktree operations, document operations, Studio configuration state, and recent-folder suggestions.
* The configuration API and generated/frontend profile types expose `module_links` consistently. Updating one module's folder replaces or inserts that module's link for the active profile without disturbing other links.
* The guided-tour module step and every ordinary Studio module-creation surface collect the module name and folder in one form, reusing the established folder-selection behavior and recent-folder suggestions.
* `Create module` is enabled only when both trimmed module name and folder values are present. No separate folder modal is stacked over the guided-tour coach mark.
* Creation is user-visible as one operation but is implemented as ordered create-then-link work. The UI advances or closes only after both calls succeed.
* After module creation succeeds, the returned module ID is retained as retry state. If linking fails, the surface displays the error and a retry attempts the link for that same ID rather than creating another module.
* Module selection checks for an active-profile folder link before mutating the selected module or hydrating its workspace. When absent, it opens the existing module-folder modal with the requested module ID.
* Successful folder submission resumes the pending selection. Cancelling or failing the modal leaves the previously selected module unchanged and does not enter the requested module.
* The module-folder link architecture and migration must be recorded in a new Studio ADR. The ADR captures why local settings were chosen over planning data, why profiles remain positional, and why a UI-enforced invariant is accepted instead of database referential integrity.
* The domain glossary's `Module folder` definition is authoritative. Existing `Welcome screen` and `Guided tour` definitions already describe the intended behavior and require no semantic change.

## Testing Decisions

* Tests assert observable behavior at the highest existing seam: rendered welcome/tour/module surfaces, public stores and configuration endpoints, and the public terminal/worktree/document operations that consume a folder. They do not assert private helper implementation or component-local state.
* The existing welcome-screen component tests cover both flag modes. Projects disabled must render only providers, use `Get started`, reuse an existing bootstrap selection, resolve/select a missing default, never start with a null project ID, and show retryable inline resolution errors. Projects enabled must retain `Continue` and the existing project form.
* The existing guided-tour component tests cover the combined module name/folder form, disabled submit state, ordered create-and-link success, link failure after creation, retry against the retained module ID, correct advancement, and unchanged skip behavior.
* Existing Studio module-tab/add-module tests cover ordinary module creation with the same required folder behavior, including successful linking and retry without duplicate creation.
* Store-level selection tests cover a linked module selecting normally, a pathless module opening the folder modal before selection, successful submission resuming the pending selection, and cancel/failure preserving the prior selection.
* Existing module-folder modal tests remain the prior art for folder input, recent-folder suggestions, active-profile scoping, persistence errors, and modal cancellation. Fixtures and assertions migrate from the legacy dictionary to the link list.
* Settings-store endpoint tests cover current-profile round trips with `module_links`, preservation of unrelated profile and recency fields, and rejection/handling behavior already established by the configuration API.
* A focused settings migration test loads a realistic legacy `profiles.json`, verifies every mapping becomes the equivalent active-profile links, saves the file, and verifies the legacy field is no longer emitted. Empty mappings and multiple profiles are included.
* Existing public-behavior tests for prompt building, terminal session creation, agent prompt construction, worktree APIs, and document services are updated to seed module links and demonstrate that each surface resolves the expected path. Missing-link behavior remains explicit at each backend boundary.
* Default-project bootstrap tests and welcome tests share expectations for canonical identifiers and fallback naming, proving that both callers use one behavior rather than duplicating resolution rules.
* The relevant Vitest result is compared with the documented baseline of nine pre-existing failures. Those failures are not counted as regressions, but every new or changed focused test must pass and no additional failures may appear.

## Out of Scope

* Creating implementation tickets or decomposing this Story into child work items during the Spec stage.
* Removing Projects from the tracker domain, REST API, MCP tools, or planning database.
* Changing the installation feature flag into a user preference, remote flag, or runtime-editable setting.
* Adding durable profile IDs, a profile picker, profile synchronization, or otherwise deciding whether the profile dimension should survive long term.
* Moving module paths into the planning database or adding a foreign key between local settings and tracker modules.
* Validating that a stored module ID exists in planning data as part of the settings-file migration.
* Changing onboarding acknowledgement, skip semantics, or reload/resume behavior.
* Changing the guided tour's existing feature-aware opening-step algorithm.
* Redesigning terminal, worktree, document, or agent behavior beyond consuming the new module-link representation.
* Automatically repairing, deleting, or garbage-collecting links whose modules no longer exist.

## Further Notes

* This specification intentionally includes the scope expansion agreed during grilling: onboarding behavior, the local settings reshape, and enforcement of the no-pathless-module invariant are one coherent change.
* The first-class module-folder link is a cross-boundary architectural choice and must ship with its ADR; the implementation is incomplete without that decision record and the already-agreed glossary entry.
* The profile dimension remains deliberately open for future reconsideration. The current implementation keeps it because collapsing to one path per module now and restoring per-profile paths later would be the more expensive migration.
* Development databases, caches, generated SDK output, sidecars, native libraries, and build output remain uncommitted, in accordance with repository policy.