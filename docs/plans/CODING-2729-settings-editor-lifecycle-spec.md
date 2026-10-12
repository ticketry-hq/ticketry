# CODING-2729: Shared settings editor lifecycle

Story: Share settings draft, hydration and save workflows.
Work item: `31638e5f-3b87-47e9-acd2-03a237312149`. Specification date: 2026-10-12.

## Problem Statement

A Studio developer who adds a setting, or another small editor over a saved record, has to write the whole edit lifecycle again. That means:

- loading the saved value;
- copying it into a draft;
- noticing when the saved value arrives late or changes underneath the draft;
- working out whether the draft is dirty;
- saving, and adopting the authoritative response;
- discarding back to the saved value;
- showing loading, saving, success and error feedback;
- keeping a failed draft for retry;
- making sure a save that finishes late cannot touch a different record.

Three editors do this today, each in its own way:

- **Conversations settings** keeps its own saved copy and draft in component state. It reads and writes through a runtime path that bypasses Apollo, so the Apollo cache never holds the saved starter prompt.
- **Model configuration** reads the provider catalog through Apollo, then copies it into four pieces of component state: saved catalog, activated providers, Codex profiles and launch default. That second snapshot of server data breaks the "Apollo is the one state owner" rule. The file has also grown past the 300–400 line guidance. Its date-picker controls stay enabled while a save is running, and a successful save then overwrites the draft with the saved response. Any edit made during the save is silently lost.
- **Launch configuration** on the State configuration panel has the most careful implementation. Two private hooks handle identity switches, delayed hydration, protecting dirty text from refreshes, and one serialized latest-wins autosave queue per identity. That care exists because of real defects: ticket #1372 wrote a stale empty prompt over a configured one. None of this is reusable, so the two other editors don't benefit from it.

Each new setting therefore costs another full lifecycle, and each copy can get a different rule subtly wrong.

## Solution

Studio gets one small shared **editor lifecycle** module. It supplies the behavior every editor over a saved value needs:

- a draft that follows the authoritative value correctly across identity changes and delayed hydration;
- dirty tracking;
- discard back to the authoritative value;
- save sequencing in two modes:
  - **explicit commit**, where the user presses Save;
  - **autosave**, where each change or blur saves through a serialized latest-wins queue;
- identity-scoped completion, so a late save never affects another record;
- one status model for loading, load failure, saving, saved and save failure.

Authoritative values always come from Apollo. The editor keeps only unsaved input.

Ordinary controls can be declared as **field descriptors**: a key, an accessible label, a control kind, constraints and validation. A small renderer draws them with the existing Settings primitives. A new ordinary setting then needs only its descriptors, an optional record-level validation, and a save binding.

Domain-specific editors use the lifecycle but keep their domain rules explicit in their own feature. For example, the Launch default picker's provider → model → reasoning dependencies, the default-provider deactivation guard, Codex profile cascades, and workflow-revision conflicts stay where they are.

Three editors adopt the module:

| Editor | Save mode |
| --- | --- |
| Conversations settings | explicit commit, with Save and Discard inside the panel |
| Model configuration | explicit commit, driven by the Settings commit bar through its existing imperative handle and callbacks |
| Launch configuration | autosave |

The user sees the same screens and interactions as today. The one exception is where today's behavior contradicts the Story's acceptance criteria: an edit made while a Model configuration save is in flight is now kept, rather than overwritten.

**Owner decisions (2026-10-12):**

1. The "representative new ordinary setting" is a **test-only descriptor fixture**. It proves the descriptor path through the shared lifecycle in a rendered test. No new user-visible setting is added, and the stored `auto_close` field stays without a control.
2. Each surface **keeps its current save mode**: in-panel buttons, Settings commit bar, or autosave.

## User Stories

1. As a Studio developer, I want to add an ordinary setting by declaring its fields, validation and save binding, so that I don't re-implement loading, dirty, save, discard and error handling.
2. As a Studio developer, I want the shared module to work with any authoritative value I pass it, so that it serves host settings, the provider catalog and per-state launch bindings alike.
3. As a Studio developer, I want the editor draft to reset when the edited record's identity changes, so that values from one record never show up while editing another.
4. As a Studio developer, I want an editor mounted before its saved value arrives to adopt that value when it arrives, so that a delayed load never leaves an empty form that later overwrites stored data.
5. As a Studio developer, I want a later change to the authoritative value to update a clean draft but leave a dirty draft alone, so that a refresh or a save round-trip never erases text the user is still typing.
6. As a Studio developer, I want "saved" to clear the dirty flag only when the draft still equals what was saved, so that an edit made during a save stays pending.
7. As a Studio developer, I want explicit-commit and autosave modes from the same module, so that each surface keeps its interaction model while sharing one implementation.
8. As a Studio developer, I want autosaves for one identity serialized with only the newest queued value kept, so that revision-guarded writes always start from the revision the previous save installed.
9. As a Studio developer, I want a save that completes after the identity changed to have no effect on the new identity, so that late responses cannot mark another record saved or change its fields.
10. As a Studio developer, I want the saving indicator scoped to the current identity, so that switching records does not show another record's save as running.
11. As a Studio developer, I want one status model (loading, load failed, saving, saved, save failed), so that every editor reports progress and errors the same way.
12. As a Studio developer, I want a helper that turns an API error into an actionable message, including the server's detail and 422 field lists, so that I don't copy error-unpacking code into each panel.
13. As a Studio developer, I want to keep surface-specific feedback text, so that Conversations still says "Conversation settings saved." and Models still says "Model configuration saved.".
14. As a Studio developer, I want field descriptors for single-line text, multi-line text and checkbox controls, with optional character limits and counters, so that ordinary controls need no hand-written markup.
15. As a Studio developer, I want descriptor validation (per field and per record) to block saving and show its message, so that invalid values never reach the server.
16. As a Studio developer, I want provider, model, reasoning and profile dependencies to stay explicit in the workflows feature, so that the descriptor layer doesn't absorb domain rules it can't express.
17. As a Studio developer, I want the shared module to hold no domain knowledge and import nothing from app or feature code, so that it passes the module-boundary rules and stays reusable.
18. As a Studio developer, I want the module split into purpose-named files under the size guidance, so that the file tree explains it.
19. As a Studio developer, I want the Conversations setting read through Apollo and the saved response written back into that same Apollo read, so that Apollo is the only holder of the saved starter prompt.
20. As a Studio developer, I want Model configuration to read its saved catalog straight from the Apollo catalog read, so that the panel no longer keeps a second snapshot of server data.
21. As a Studio developer, I want the two launch-binding editor hooks replaced by the shared module with their documented defect history preserved, so that their protections apply everywhere.
22. As a Studio developer, I want the capability guide to list the settings editor lifecycle as Supported now, with an example and its measured authoring cost, so that the next author knows which path to use.
23. As a Studio user editing Conversations settings, I want the saved starter prompt to load into the panel, so that I can see and change my standing instructions.
24. As a Studio user, I want Conversations' Save and Discard disabled when nothing changed or while loading or saving, so that I can't make an empty or duplicate save.
25. As a Studio user, I want Discard to restore my last saved starter prompt, so that I can abandon an edit.
26. As a Studio user, I want a failed Conversations save to keep my text and say it could not be saved, so that I can retry without retyping.
27. As a Studio user, I want a failed Conversations load to say the settings could not be loaded, so that I know the empty field isn't my saved value.
28. As a Studio user, I want the 8,000-character limit and live counter to stay, so that I know how much room is left.
29. As a Studio user opening Conversation configuration from the Conversations header, I want the prompt focused once it has loaded, so that I can type straight away.
30. As a Studio user, I want my stored auto-close preference passed through unchanged when I edit the prompt, so that a prompt edit never flips a hidden setting.
31. As a Studio user, I want leaving the Conversations tab, or closing Settings, not to save my draft, so that only an explicit Save writes.
32. As a Studio user editing Model configuration, I want the unsaved-change count, Save changes and Discard in the Settings commit bar to behave as today, so that the screen feels the same.
33. As a Studio user, I want an edit I make while a Model configuration save is running to stay pending afterwards, so that my change isn't silently thrown away.
34. As a Studio user, I want Model configuration Discard to restore the last saved catalog, so that I can abandon a set of provider and default changes.
35. As a Studio user, I want a failed Model configuration save to keep my draft and the unsaved count, and show the server's reason, so that I can fix it and retry.
36. As a Studio user, I want the Applied changes log to keep recording pending and applied Models changes, so that I can see what changed in this session.
37. As a Studio user, I want deactivating the current default provider to stay refused with "Repoint the launch default before deactivating …", so that I can't leave launches without a default.
38. As a Studio user, I want removing a Codex profile that is used by the global default to clear that default's profile, so that the default never names a removed profile.
39. As a Studio user, I want Model configuration to keep rejecting incompatible provider, model and reasoning combinations before saving, so that Settings and the per-state form enforce the same rules.
40. As a Studio user, I want my Model configuration draft to survive switching Settings tabs, so that browsing another section doesn't discard work.
41. As a Studio user, I want Model configuration to show the saved catalog when another surface changes it, if I have no unsaved edits, so that I'm never looking at stale saved data.
42. As a Studio user editing a state's launch configuration, I want the prompt saved when I leave the field, picker choices saved when committed, and stage skills saved on each change, so that it behaves as today.
43. As a Studio user, I want switching to another state or issue type to show that record's stored launch configuration, never values from the one I left, so that I never save one state's settings onto another.
44. As a Studio user, I want a launch configuration that loads after the panel opened to show its stored prompt, so that saving a provider change never wipes the stored prompt.
45. As a Studio user, I want quick successive launch-configuration changes saved in order, with the last change winning, so that the stored binding matches what I last chose.
46. As a Studio user, I want "Applying…" shown only for the state I'm looking at, so that another state's save doesn't look like mine.
47. As a Studio user, I want a stale workflow revision to keep reloading the latest policy with "Workflow changed elsewhere. Latest settings loaded.", so that conflicts stay understandable.
48. As a Studio user, I want a failed launch-configuration save to keep my edit visible with its error, so that I can correct it.
49. As a reviewer, I want each adopted editor's lifecycle code removed and replaced by the shared module, so that there is one implementation to review.
50. As a reviewer, I want the shared lifecycle's guarantees proven by rendered tests on the real screens, plus one test-only descriptor harness, so that the guarantees are tested where users meet them.
51. As a maintainer, I want no new GraphQL operation, mutation or Rust change, so that the public contract surface stays as it is.

## Implementation Decisions

### Reuse record (answers the CLAUDE.md "Reuse before writing code" questions)

| Question | Answer | Existing example |
| --- | --- | --- |
| Which existing module or framework can do this? | Apollo Client already owns server data, watched reads and cache writes. The launch-binding editor's two private hooks (identity-aware draft fields and a serialized save queue) already implement the hardest lifecycle rules. The Settings primitives provide field, button and status-line styling. The CODING-2728 declared-mutation module owns write transport, cache effects and error mapping. | The State configuration panel's launch configuration form; the provider catalog query and update (which writes its authoritative response back into the catalog read); the Settings primitives used by the Conversations and Models panels. |
| What can be configuration or generated code? | Ordinary controls become field descriptors. Read and write documents are the existing generated operations for the instant launch setting and the provider catalog. | The generated instant-launch and provider-catalog documents in the settings feature. |
| What genuinely new behavior must we implement? | Generalize the two launch-binding hooks into a domain-free draft and save module. Add an explicit-commit mode next to the existing autosave queue. Add discard, a shared status model, the descriptor renderer, and API-error message extraction. Move the Conversations read onto Apollo. | None; this is the capability the guide lists as "Proposed in CODING-2729". |

### Shared editor lifecycle module

- **Placement.** A new purpose-named folder in Studio's shared layer for editing plumbing.
  - It is cross-feature: the settings and workflows features both use it.
  - It has no domain knowledge, and it imports nothing from app or feature code. This satisfies the module-boundary test.
  - Split it into purpose-named files: draft tracking, save sequencing, the combined lifecycle hook and its status model, field descriptor types and validation, the descriptor field renderer, and save-error message extraction. Each file stays well under the 300–400 line guidance.
- **Authoritative value input.** The caller supplies:
  - the current authoritative value (`undefined` while not yet hydrated);
  - an **identity** string for the record being edited;
  - an equality function over draft values.

  The module never fetches. Loading and load failure come from the caller's Apollo read state, passed in.
- **Draft rules.** These are generalized unchanged from the launch-binding hook and are part of the contract:
  1. When the identity changes, the draft resets to the new identity's authoritative value, and it is not dirty.
  2. When the first authoritative value arrives for an unhydrated identity, the draft adopts it, and it is not dirty.
  3. When the authoritative value changes later, the draft adopts it only if the draft is not dirty. A dirty draft is never overwritten by a refresh.
  4. Marking a value as saved clears the dirty flag only when the current draft equals that value. Otherwise the draft stays dirty with the newer edit.
  5. Discard sets the draft to the current authoritative value and clears dirty.

  The draft is ephemeral component-local unsaved input. It is never written to a store or to the Apollo cache, and it is lost on unmount. That keeps today's "Conversations loses its unsaved draft when its tab is left" and "closing Settings does not save" behavior.
- **Save sequencing.** Both modes take a **save binding**: an async function from a draft (or a save input derived from it) to the authoritative saved value. The binding owns transport and cache effects; the lifecycle owns ordering and identity.
  - **Explicit commit.** `save()` validates, then sends the current draft. At most one save runs per identity at a time. A save request while one is running is ignored, matching today's disabled buttons. On success:
    - the authoritative value is already in Apollo, because the binding wrote it;
    - the lifecycle marks the sent value as saved (draft rule 4), so edits made during the save survive;
    - the status becomes "saved".

    On failure, the draft stays dirty and editable, and the status becomes "save failed" with the error.
  - **Autosave.** This is the serialized latest-wins queue, lifted from the launch-binding save queue:
    - one queue per identity;
    - while a save runs, only the newest pending input is retained;
    - each save completes, including its authoritative refetch, before the next one starts;
    - the first error is reported after the queue drains;
    - the "running" marker is cleared inside the drain itself. The existing comment explains why, and it is preserved.
  - **Identity scoping (both modes).** When a save completes for an identity that is no longer current, it does not mark anything saved, change any field, or set any status for the current identity. The saving indicator reflects only the current identity's queue.
- **Status model.** The lifecycle exposes:
  - `loading` (from the caller);
  - `loadError`;
  - `saving`;
  - `dirty`;
  - `validation` (the first descriptor or record validation message);
  - a last-outcome value: none, saved or failed, plus the error.

  Editing clears the last outcome, as both panels do today. Each surface keeps its own feedback text and tone. The lifecycle supplies states, not wording.
- **Save-error messages.** One shared helper turns an error into a message:
  - an API error's string `detail`;
  - else its 422 list of `msg` entries, joined with "; ";
  - else the error's message.

  Model configuration's local copy of this logic is deleted. Conversations keeps its fixed "could not be saved/loaded" wording.

### Field descriptors

- A descriptor declares:
  - its key in the draft;
  - an accessible label;
  - an optional visible heading and description;
  - its kind: single-line text, multi-line text or checkbox;
  - optional constraints: maximum characters with an optional live counter, and rows or placeholder for text;
  - an optional validator from field value (and the whole draft) to a message or nothing.

  A record-level validator can also be supplied with the editor definition.
- The descriptor renderer uses the existing Settings field classes and status line. A descriptor-rendered control must produce the same roles, accessible names, attributes and classes as the hand-written control it replaces. Layout, spacing and copy stay unchanged.
- Only ordinary controls use descriptors. The Launch default picker, Stage skills field, provider activation list and Codex profile list stay explicit components in the workflows feature, with their dependency logic.

### Conversations settings adoption

- **Read.** The panel reads the instant launch setting through an Apollo watched query of the existing generated read operation. A small query hook in the settings feature decodes it with today's rules: a missing or malformed value becomes an empty prompt and false auto-close.
- **Write.** The save binding sends the existing generated update operation with the draft's prompt and the authoritative auto-close value, unchanged.
  - It then writes the authoritative response into the read query's cache entry. The read and the mutation return the same type through different root fields. That type has no normalized identity, so Apollo would not update the read on its own.
  - If the CODING-2728 declared-mutation module is on the branch when this work starts, express the write as a declaration whose commit effect writes that read. Otherwise call Apollo's mutate and write the read directly, matching the provider-catalog update precedent.
  - Either way, there is exactly one write path. The runtime settings read/write routes are no longer used by this panel.
- **Ordinary control.** The starter prompt becomes one multi-line text descriptor with:
  - the accessible label "Conversation starter prompt";
  - the visible heading "Starter prompt" and its existing description;
  - an 8,000-character maximum with the right-aligned counter;
  - 8 rows;
  - the existing placeholder;
  - the monospace, resizable styling.

  The DOM it renders must match today's.
- **Preserved behavior:**
  - Save changes (accessible name "Save conversation settings") and Discard sit in the panel, disabled while loading, while saving, or when the draft is clean.
  - The textarea is disabled while loading or saving.
  - "Conversation settings saved." on success, "Conversation settings could not be saved." on failure with the draft kept, and "Conversation settings could not be loaded." on a load failure.
  - The heading is shown in the Settings modal and hidden in the Conversation configuration overlay.
  - `focusPrompt` focuses the prompt once loading has finished.
  - Auto-close stays unrendered. The existing acceptance assertion that no auto-close checkbox exists stays.
- The panel's local saved/draft/loading/saving/message state is deleted.

### Model configuration adoption

- **Read.** The authoritative catalog comes from an Apollo watched read of the provider catalog query, exposed by a small selector hook in the workflows feature's provider queries. It maps rows into the existing catalog shape. Configurable capabilities for the pickers come from the same read.
  - The panel's saved-catalog, activated-providers, Codex-profiles and launch-default state copies are deleted.
  - The draft is one editable catalog value: activated providers, Codex profiles and launch default. The new-profile text box stays plain local input outside the draft and outside the dirty count, as today.
- **Write.** The save binding is the existing provider catalog update, which already writes its authoritative response into the catalog read. After a successful save it still refreshes the workflow editor store's provider capabilities exactly as today. Removing that store write is out of scope.
- **Commit bar contract (unchanged):**
  - The imperative handle keeps `save` and `discard`.
  - `onCommitStateChange` keeps reporting the outstanding count, saving flag and change descriptions, computed by the existing change-ledger helper against the authoritative catalog.
  - `onChangesApplied` fires with the applied changes after a successful save.
  - `onStatusChange` keeps the success, attention and danger tones and texts, including "Model configuration saved.".
  - The Settings modal still lazy-loads the panel, keeps it mounted while its tab is hidden (so the draft survives rail navigation), shows the commit bar only on Models, and drives the Applied changes ledger.
- **Domain logic stays explicit in the panel's feature:**
  - the default-provider deactivation guard and its attention message;
  - Codex profile add (trim, deduplicate, sort) and remove, including clearing the default's profile when that profile is removed;
  - record validation through the shared launch binding option validator, so Settings and the per-state form reject the same combinations. This becomes the lifecycle's record-level validator.
- **Defect fix (within the acceptance criteria).** An edit made while a save is in flight now stays pending afterwards (draft rule 4), instead of being overwritten by the response. Controls that are disabled during a save today stay disabled.
- **File split.** The panel is split by concern: catalog draft mapping and change counting, the providers section, the Codex profiles section, the global launch default section, and a thin panel composing them with the lifecycle. Its public import path and exported types stay stable, or the module-boundary test's allowlist is updated deliberately in the same change.

### Launch configuration adoption

- The launch configuration form uses the shared lifecycle in autosave mode.
  - Its identity is the issue type and state pair.
  - The authoritative value is the stored binding rendered as form fields. An absent binding means "not hydrated" until the workflow settings arrive.
  - The save binding is the caller's existing save function. After CODING-2728 that is the declared launch-binding upsert; this Story does not change it.
- **Preserved behavior:**
  - The prompt saves on blur. Picker commits save an input built from the committed picker value, not from the previous render's input; the existing comment about the 422 pair stays. Stage-skill changes save immediately with the new list.
  - "Applying…" shows only for the current identity.
  - "Changes apply when a field is changed or left." stays.
  - Validation and caller errors show in the danger status line.
  - Marking saved maps the input's nulls back to form strings.
  - A stale workflow revision still reloads the latest policy, with the store's existing notice.
- The two private launch-binding hooks are deleted once the form uses the shared module. Their defect-history comments (#1372 and the drain-completion race) move with the lifted logic.

### Documentation

- **Capability guide.** Change the Setting row's "Shared draft, hydration and save is Proposed in CODING-2729" to *Supported now*. Name the shared editor lifecycle and field descriptors as the approved path, and Conversations settings as the closest working example. Record the measured authoring cost of the test-only descriptor fixture: its line count and the files it touched.
- **Settings feature map.** Add a "Settings editor lifecycle" section covering:
  - what the module guarantees (the draft rules, both save modes, identity scoping, the status model);
  - its entry points and adopters;
  - how to declare an ordinary setting;
  - its test coverage.

  Record the launch configuration form's adoption there too. The workflows-and-issue-types feature map does not exist in this checkout and is not created here.
- **Glossary.** The glossary entry for the Conversation launch flow says launch authority resolves auto-close from Settings. The launch authority currently reads only the stored starter prompt. Correct the glossary only if the Tickets or implementation stage confirms this against the launch authority. Do not add auto-close behavior.

### Ordering with sibling Stories

- **CODING-2728 (declared mutation cache effects)** is in Implement. It moves the launch-binding upsert and other workflow writes onto declared Apollo mutations, and leaves settings writes for later adopters.
  - The ticket that moves the Conversations write onto Apollo should be blocked by CODING-2728's shared declared-mutation module ticket (CODING-2875), so the write uses that module rather than adding another pattern.
  - The launch-form adoption touches the form and its hooks, not the upsert transport. It can proceed independently, but must rebase cleanly over CODING-2728's workflow write changes.
- **CODING-2727 (generated GraphQL contracts)** relocates server-shaped types, including the provider catalog and launch binding types, out of the shared types module. Use whatever type locations exist on the branch when implementing. Do not reintroduce shared mirrors.

### Suggested ticket slicing (in dependency order)

1. Shared editor lifecycle module (draft rules, both save modes, identity scoping, status, error messages, descriptors and renderer), with the test-only descriptor harness and its rendered tests.
2. Launch configuration form on the shared lifecycle in autosave mode; delete the two launch-binding hooks.
3. Conversations settings on Apollo and the shared lifecycle, with the starter prompt as a descriptor. Blocked by 1 and by CODING-2875.
4. Model configuration on the Apollo catalog read and the shared lifecycle, including the file split and the in-flight-edit fix.
5. Documentation (capability guide row, settings feature map section), measured authoring cost, and the full gate.

## Testing Decisions

### What a good test is here

- Test behavior through what users and callers see: visible values, enabled and disabled controls, status text, focus, and the GraphQL operations and variables that reach the transport.
- Do not assert on hook internals, render counts or which helper was called.
- Drive timing explicitly with deferred transport responses: delayed loads, in-flight saves, out-of-order completion. Avoid sleeps.
- Prove persistence by reading back the authoritative value, by remount or by a fresh read, not by the panel's own echo.

### Seams (user-confirmed 2026-10-12)

1. **Primary seam: rendered Studio surfaces over the existing GraphQL runtime transport stub.**
   - Render the Settings modal (Models and Conversations), the Conversation configuration overlay, and the State configuration panel or launch configuration form, with the substituted desktop or browser GraphQL runtime used by today's acceptance tests.
   - Apollo sends through the same runtime transport, so moving the Conversations read onto Apollo keeps these stubs effective.
   - Prior art: the Conversations settings acceptance cases (overhaul-203 edit and clear; overhaul-313 failed draft, retry, discard, failed read), the Settings acceptance cases (model validation, discard and save failure, ledger), the Codex profiles cases (overhaul-297), the provider catalog runtime cases (overhaul-79, 391, 407), the launch configuration convergence cases (overhaul-246, 262, 263), the stage-skill serialization cases (overhaul-328, 329), and the launch configuration form component test (hydration under a mounted form, switching states, keeping typed text across a save refresh).
2. **Secondary seam: a test-only descriptor harness.**
   - A test renders a small editor built only from a test-only editor definition:
     - a single-line text descriptor with a required/length validator;
     - a checkbox descriptor;
     - a record-level validator;
     - a stub save binding over a stub authoritative value.
   - The harness contains no lifecycle code of its own. That is the point: it proves a new ordinary setting needs only declarations and a binding.
   - It is the acceptance demonstration for "a representative new ordinary setting".

### Cases to add

**Shared lifecycle, through the descriptor harness (seam 2):**
- render from descriptors, with accessible names;
- dirty tracking, and Save and Discard enablement;
- a validation message blocks save;
- a successful save adopts the authoritative value;
- an edit during an in-flight save stays dirty afterwards;
- a failed save keeps the draft and shows the error;
- discard restores the authoritative value;
- an identity switch resets the draft;
- a late save after an identity switch leaves the new identity untouched;
- a delayed authoritative value hydrates an unhydrated editor;
- a later authoritative change updates a clean draft and leaves a dirty draft alone;
- autosave mode serializes a burst and sends the newest value last.

**Conversations (seam 1):**
- A delayed load keeps controls disabled until it lands, then focuses the prompt in the overlay.
- The read goes through Apollo: a remount within the same client shows the saved prompt, and a save updates the cached read.
- An authoritative change while clean updates the panel.
- Auto-close passes through unchanged on save, and no auto-close control is rendered.
- Leaving the tab, or closing, does not save.
- overhaul-203 and overhaul-313 stay green unchanged.

**Model configuration (seam 1):**
- A picker edit during an in-flight save remains pending afterwards, and the outstanding count and ledger reflect it.
- Discard restores the Apollo catalog.
- A failed save keeps the draft, count and server reason.
- The draft survives switching rail tabs.
- A catalog change from another surface updates a clean panel and leaves a dirty draft alone.
- The existing Models, Codex profile and catalog runtime cases stay green.

**Launch configuration (seam 1):**
- Switching state while dirty shows the new state's stored values.
- A save for the previous state that resolves after the switch neither marks the new state saved nor changes its fields, and "Applying…" belongs only to the visible state.
- Delayed hydration saves the stored prompt with a provider change.
- An autosave burst sends one request at a time, ending with the latest value against the refreshed revision.
- A failed save keeps the edit and shows the error.
- The existing form test and overhaul-246/262/263/328/329 stay green.

### Numbering and gates

- New rendered acceptance cases go in the numbered overhaul acceptance files. They take the next unused `overhaul-N` numbers. Other branches already use numbers above this checkout's highest (overhaul-466); the main roadmap branch has reached at least overhaul-823. Check every active branch before choosing, to avoid collisions.
- **Gates.** From the root:
  - `npm run typecheck`;
  - `npm run reuse:check`;
  - `npm run test --workspace @worktracker/studio`;
  - `npm run build --workspace @worktracker/studio`, which runs the architecture lint first, including the module-boundary rules;
  - `npm run test:overhaul --workspace @worktracker/studio`.

  Run `npm run test:e2e:overhaul` and the Models database browser spec when a browser environment is available. Report failures you did not introduce as such, with evidence. Do not claim a clean gate you did not see.

## Out of Scope

- **Contract changes.** No Rust, Seaography, SeaORM, GraphQL schema, SDL or operation changes, and no new or widened mutation or input.
- **New visible settings.** No new visible setting, and no auto-close control or auto-close launch behavior.
- **Interaction changes.** No visual or interaction change beyond keeping edits made during an in-flight Models save. Any other change would need mockups and approval first.
- **Save modes.** No change of save mode on any surface: no autosave for Conversations or Models, and no explicit Save for launch configuration.
- **Keyboard shortcuts.** Migrating the keyboard shortcuts settings, which use the same non-Apollo settings route and a listening-mode editor, is out of scope. It can adopt the module later.
- **Other draft editors.** Migrating other draft editors (onboarding provider selection, conversation rename, ticket detail fields, workflow catalog editors) is out of scope. They are candidate later adopters.
- **Workflow editor store.** Removing the workflow editor store's provider-capabilities copy or other mirrors is out of scope.
- **Missing feature map.** The workflows-and-issue-types feature map is not created in this checkout.

## Further Notes

- **Decision record.**
  - Ideas triage moved this Story to Spec on 2026-10-10.
  - On 2026-10-12 the owner decided:
    - a test-only descriptor fixture instead of a new user-visible setting;
    - every surface keeps its save mode;
    - two test seams: rendered surfaces over the GraphQL transport stub, plus the test-only descriptor harness.
- **Transport parity.** In both runtimes, the settings read and write routes are the same function as WorkTracker reads, over the runtime GraphQL transport proxy. Apollo's transport link uses the same proxy. Moving the Conversations read onto Apollo changes cache participation and the link chain, not the wire path.
- **Cache identity.** The instant launch and keybinding settings return the same GraphQL type with no `id`, so Apollo does not normalize them. Writing the authoritative response into the read query is required for the Conversations panel to see its save. Adding a scope-and-key type policy was considered and is not chosen, because it would also affect keybinding settings.
- **Defect history to preserve.**
  - Ticket #1372: a form mounted before hydration wrote an empty prompt over the stored one, and the launch policy resolver then refused every launch for that type and state.
  - The save queue's drain-completion race: clearing "running" in a promise `finally` stranded an edit queued between loop exit and settlement.
  - Both are now guarantees of the shared module and must keep their comments and tests.
- **Existing feature-map description.** The main roadmap branch's settings feature map describes the same Settings behavior this spec preserves:
  - Models keeps its draft across tabs; Conversations loses an unsaved draft when unmounted;
  - closing is not a save;
  - auto-close is a stored field with no control.

  Use it as the behavioral reference when porting the feature-map update.
