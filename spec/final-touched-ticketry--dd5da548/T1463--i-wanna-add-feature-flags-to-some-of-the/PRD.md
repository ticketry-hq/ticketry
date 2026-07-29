# Gate projects behind a config-file feature flag and simplify onboarding

**Work item:** CODIN-1463
**Status:** refined — ready for implementation
**Related ADR:** [`studio/docs/adr/0004-projects-behind-an-installation-feature-flag.md`](../../../studio/docs/adr/0004-projects-behind-an-installation-feature-flag.md)

## Problem Statement

Projects is the first thing a new user meets and the last thing they need. First-run
onboarding opens by asking for a project name and key, the sidebar's leftmost pane is a
list of projects, and keyboard pane traversal starts there — all before the user has
created a single piece of work. For most installs there will only ever be one project, so
the concept is pure learning curve: a level of hierarchy to understand, name and navigate
that buys nothing.

At the same time the flow that actually matters is missing a step. A module cannot launch
an agent without a module folder — the prompt builder, session spawn, the worktrees API and
the documents service all read `module_folders` — yet onboarding never asks for one. The
first launch after onboarding therefore stops to ask, which is exactly the interruption
onboarding was supposed to prevent.

Removing Projects outright is not available: modules, work items, states, issue types,
launch bindings and per-type workflows are all project-scoped, and project creation is what
seeds every one of them. The concept has to stay in the domain even when it leaves the
screen.

## Solution

An installation declares whether it has Projects at all, in a small JSON file next to its
existing local configuration. By default it does not. When Projects is off:

- The Projects pane, the Add Project affordance and project management in Settings are
  absent, and keyboard pane traversal never lands on a projects pane.
- Everything that needs a project silently gets the **resolved project** — the project
  whose key is `CODING`, created fully configured the first time it is asked for.
- First-run onboarding is: declare your agent subscriptions → create your first module,
  naming it and choosing its folder in one step → type your first task → land in the ticket
  workspace.

Turning Projects back on is one line in one file. The project pane returns to onboarding as
a single extra step, the sidebar pane returns, and nothing about the domain, the REST
contract or the MCP tools has changed in the meantime.

## User Stories

**Living without Projects**

1. As someone opening Studio for the first time, I want the application to decide for me
   that I do not need Projects, so that I am not asked to name something I do not yet
   understand.
2. As a user with Projects off, I want the sidebar to begin at Modules, so that the first
   thing I see is the first thing I care about.
3. As a keyboard user with Projects off, I want pane navigation to move between Modules,
   Stories and the workspace only, so that no keystroke lands me on a pane that is not
   there.
4. As a user with Projects off, I want modules I create to belong somewhere valid without
   my choosing where, so that creation never fails for a reason I cannot see.
5. As a user with Projects off, I want work items, states, issue types and workflows to
   behave exactly as they always have, so that hiding a level of hierarchy does not quietly
   change how my work behaves.
6. As a user with Projects off, I want the workflow and issue-type settings to keep working,
   so that I can still configure states and transitions without a project selector.
7. As a user with Projects off, I want agents to launch exactly as before, so that the flag
   changes what I see and not what the product does.
8. As a user restarting the app, I want my module and task selection restored without a
   project ever being chosen, so that startup lands me where I left off.

**Turning Projects on**

9. As an experienced user, I want to enable Projects by editing one line of one file, so
   that I do not need a migration or a rebuild to get the full model back.
10. As a user who has just enabled Projects, I want the Projects pane, the Add Project
    affordance and project management in Settings to all return together, so that the
    feature is either present or absent and never half-present.
11. As a user who has just enabled Projects, I want my existing modules and work items to
    still be there under the project that owned them, so that the flag never moves data.
12. As a user who enables Projects before first run, I want onboarding to ask me to create a
    project, so that I name my first project myself rather than inheriting a default.
13. As an integrator, I want the REST and MCP project endpoints to behave identically in
    both modes, so that scripts and agents do not have to know which mode an install is in.

**Onboarding**

14. As a new user, I want to declare which agent subscriptions I hold before anything else,
    so that onboarding cannot end in a workspace that is unable to launch an agent.
15. As a new user, I want to name my first module and choose its folder in a single step, so
    that I am not asked two questions about one thing.
16. As a new user on the desktop app, I want to pick that folder with a native folder
    picker, so that I do not have to type or paste a path.
17. As a developer running the browser build, I want to type the folder path directly, so
    that onboarding is completable on a platform with no native picker.
18. As a new user, I want to be prevented from leaving the module step without a folder, so
    that my first agent launch does not stop to ask me for one.
19. As a new user, I want to type my first task into the real capture field with a coach
    mark pointing at it, so that I learn the surface I will use every day rather than a
    demonstration of it.
20. As a new user, I want onboarding to end with my first task selected in the ordinary
    workspace, so that the transition from setup to work is invisible.
21. As a new user, I want to be able to skip onboarding at any step, so that I am never
    trapped in setup.
22. As a returning user, I want onboarding never to reappear once acknowledged, so that
    acknowledgement stays monotonic.
23. As a developer, I want to replay onboarding by discarding a development instance's data
    directory, so that I can exercise the flow without an un-acknowledge action existing.

**Operating the flag**

24. As an operator, I want a missing, empty or malformed flag file to mean Projects is off,
    so that no install can fail to start over a config file.
25. As an operator, I want the flag file to be read once at startup, so that the surface
    cannot change shape underneath a running session.
26. As an operator, I want the application never to write the flag file, so that the file on
    disk is always exactly what I put there.
27. As an operator, I want unknown keys in the flag file to be ignored rather than rejected,
    so that a file written for a newer build still starts an older one.
28. As a frontend developer, I want the flag delivered by the configuration the application
    already loads at startup, so that no surface has to wait on a second fetch to know what
    to render.

## Implementation Decisions

### The flag

- **Location.** A new `features.json` in the same local configuration directory as
  `profiles.json` — `MUXED_DATA_DIR` when set, otherwise `~/.config/worktracker-studio`.
- **Shape.** A flat object of flag name to boolean. This story defines exactly one:
  `{"projects": false}`. Unknown keys are ignored.
- **Default.** Absent, empty, unreadable or malformed all resolve to `projects: false`.
  Parsing never raises into startup.
- **Ownership.** Read-only from the application's point of view. Nothing in the product
  writes this file; there is no API to set a flag and no Settings surface for it.
- **Lifetime.** Read once at process start. Editing the file mid-session has no effect until
  restart. This is deliberate: pane order, keyboard traversal and the resolved project are
  all settled during bootstrap.
- **Why not a profile field.** Profile writes are whole-object replacements by index, so a
  flag living inside a profile is clobberable by any profile edit, and unanswerable before a
  profile is selected. The flag is a property of the installation, not of a profile.
- **Why not a database row.** It must be answerable before any project exists and must
  survive a database reset, and re-enabling should be a file edit rather than a migration.

### The contract

- `GET /config` grows a `features` object beside the existing `recent_profile_index` and
  `profiles`. No new endpoint.
- The frontend configuration store, which already loads `/config` in the bootstrap fan-out,
  exposes the flag. No new store and no second fetch.
- `openapi.json` changes only by the added response field.
- The profile write endpoints are untouched: `features` is not accepted on any write, and no
  profile field is added.

### The resolved project

- A new service in the worktracker project services answers "which project owns this":
  return the project whose slug is `CODING`; if it does not exist, create it with name
  `coding` and slug `CODING`.
- Creation goes through the existing project creation service, so the resolved project
  arrives with the standard state catalog, issue types, per-type workflows and launch
  bindings already seeded. No parallel seeding path.
- Resolution is idempotent and safe to call concurrently — two callers racing on a fresh
  install must not produce two projects.
- Other project rows are untouched and remain reachable over REST and MCP. They are
  invisible to the gated surface, not deleted, archived or migrated.
- Nothing in the domain becomes project-optional. Modules and work items stay project-scoped
  and every API keeps requiring a project id; the resolver is what supplies it.

### The gate

- The projects pane is not rendered, and pane visibility ordering drops `projects` entirely
  so keyboard traversal cannot reach it. Today that ordering function already drops
  `modules` when no project is selected; with the flag off there is always a resolved
  project, so Modules is always available.
- Startup restoration no longer focuses a projects pane; it restores the module selection
  under the resolved project and focuses Modules.
- The Add Project affordance and project management in Settings are absent.
- Workflow, state and issue-type settings operate on the resolved project.
- Backend behaviour is unchanged. The gate is presentation plus resolution — no endpoint
  changes its status code, its shape or its permissions because of the flag.

### Onboarding

- One state machine with one conditional step, not two flows:

  ```
  subscriptions
    → project              (only when projects is enabled)
    → projects coach mark  (only when projects is enabled)
    → module: name + folder
    → first task
    → handoff
  ```

- The module step captures name and folder together, reusing the combined Add Module surface
  owned by CODIN-1464 and CODIN-1466 rather than defining its own.
- The folder is required to leave the module step. Desktop shows the native picker; the
  browser uses the free-text path input that the folder selection component already renders
  when `nativeFolderPicker` is false.
- The first-task step remains a coach mark on the real idea entry, and handoff still selects
  the created Story in the ordinary workspace.
- Onboarding acknowledgement is unchanged and remains monotonic: finishing or skipping ends
  it, and there is no inverse.
- The tour remains run-local — a reload restarts it from the beginning while onboarding is
  pending.

### Vocabulary

Two glossary terms are introduced with this work and are already recorded:

- **Installation feature flag** (`studio/CONTEXT.md`) — a capability switch declared in the
  installation's local configuration file rather than in tracker data.
- **Resolved project** (`backend/worktracker/CONTEXT.md`) — the single project that owns
  every module and work item while the Projects surface is gated off.

The existing **Welcome screen** and **Guided tour** entries have been amended: the project
pane and the projects coach mark are now conditional, and module creation now captures the
folder.

## Testing Decisions

A good test here asserts what a person or a caller can observe — the response a client gets,
the project a module ends up in, the panes that are reachable, the step onboarding is on. It
does not assert that a particular store field was set, that a particular function was
called, or how the flag value travelled from disk to render.

**Seams.** Two, both of them chosen so the frontend needs no new one:

1. `GET /config` — the whole flag contract. Reading `features.json`, defaulting it, and
   surfacing it are all observable here.
2. `resolve_current_project()` in the worktracker project services — the whole
   implicit-project policy.

**What is tested where**

- *Flag loading and contract* — through the settings-store API tests, which already exercise
  `/config` and the profile endpoints against a temporary configuration directory. Cover:
  file present and true, present and false, absent, empty object, malformed JSON, unknown
  keys ignored, and that profile writes neither accept nor disturb `features`.
- *Resolved project* — through the project service tests, alongside the existing project
  creation coverage. Cover: no projects at all (creates `CODING`, fully seeded with states,
  issue types, workflows and launch bindings), `CODING` already present (returns it, creates
  nothing), other projects present but no `CODING` (creates `CODING`, leaves the others
  alone), and repeated resolution being idempotent.
- *Surface gating* — through rendered-flow tests in the Studio suite, in the style of the
  existing sidebar, bootstrap-gate and keymap tests. Cover: with the flag off the projects
  pane is not in the document, pane traversal from Modules leftward does not reach it, and
  bootstrap focuses Modules; with the flag on all three behave as they do today.
- *Onboarding* — through the existing onboarding rendered tests. Cover both orderings of the
  step machine, the module step refusing to advance without a folder, the browser path being
  completable by typing, and skip ending onboarding from every step.
- *Contract drift* — the generated `openapi.json` is regenerated and its diff is limited to
  the added `features` field.

**Prior art to follow:** `backend/apps/settings_store/tests` for configuration-directory
isolation, `backend/worktracker/tests/test_project_services.py` for service-level project
assertions, and `studio/src/test/BootstrapGate.test.tsx`, `studio/src/test/ProjectsPane.test.tsx`,
`studio/src/test/studioKeymap.test.tsx` and `studio/src/test/OnboardingWelcome.test.tsx` for
rendered-flow assertions.

## Out of Scope

- Removing the Projects concept from the domain, the REST API or the MCP tools. It stays
  project-scoped throughout; only the surface is gated.
- Any second feature flag. The file format admits more, but `projects` is the only flag this
  story defines.
- A Settings UI, an API or any other in-product way to change the flag. It is a hand-edited
  file.
- Live reload of the flag. A restart is required, by decision.
- Migrating, merging, archiving or deleting existing project rows when the flag is off.
- Choosing the resolved project by anything other than its key — no config key names it, no
  ordering heuristic picks it, no recency is consulted.
- Multi-project workflows while the flag is off, including moving work between projects.
- The combined name-and-folder Add Module surface itself, which belongs to CODIN-1464 and
  CODIN-1466. This story consumes it.
- Validating that a chosen module folder exists, is a git repository, or is readable.

## Further Notes

- An install that already holds real work in a project not keyed `CODING` will look empty
  once the flag defaults on. That is the accepted cost of a default-off flag; the remedy is
  to set `{"projects": true}`. This is called out in the ADR's consequences and should be
  mentioned in whatever release note accompanies the change.
- The worktracker glossary's **Onboarding-required project** entry describes a "freshly
  provisioned default project", but onboarding state actually lives on the workspace and
  `provision` deliberately creates no project. The entry was already imprecise before this
  work; the resolved project makes it more so. Worth a follow-up correction, not a change
  this story should make.
- The flag being read at process start means the packaged desktop sidecar reads it from
  `MUXED_DATA_DIR`, which the desktop supervisor owns. Onboarding replay by discarding a
  development instance's data directory therefore discards the flag file too, and the next
  launch is default-off.
