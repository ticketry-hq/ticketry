# Settings contains only model configuration

## Problem Statement

Ticketry's global Settings dialog currently exposes a Workflow group with `States` and `Issue types` sections alongside model configuration. The workflow sections let users create, rename, group, reorder, and delete project states and edit issue-type workflow policy from a global application-settings surface. That surface is no longer wanted. It makes Settings broader than its intended purpose and duplicates workflow-oriented controls that belong outside global Settings.

Users should encounter Settings as the place to configure launch models, without being offered project workflow administration there.

## Solution

Remove the complete Workflow group from the Settings dialog, including both the `States` and `Issue types` entries and their content. Settings opens directly to the existing `Models` experience and exposes no other selectable section.

The existing Models behavior remains intact: users can inspect provider/model choices, make staged changes, see validation or save status, discard unsaved changes, and save them. Opening Settings no longer initializes or fetches the selected project's state catalog, issue types, workflow policies, or work-item counts merely to render the dialog.

This is a Studio presentation and loading-boundary change. It does not delete workflow data, backend workflow APIs, workflow-domain modules, or state-scoped configuration that is reached from a state header elsewhere in Studio.

## User Stories

1. As a Ticketry user, I want Settings to open directly to model configuration, so that I immediately reach the only global setting I need.
2. As a Ticketry user, I want the Workflow group absent from Settings, so that project workflow administration is not presented as global application configuration.
3. As a Ticketry user, I want no `States` entry in Settings, so that I cannot reach state-catalog editing from that dialog.
4. As a Ticketry user, I want no `Issue types` entry in Settings, so that I cannot reach issue-type workflow editing from that dialog.
5. As a Ticketry user, I want no state creation controls in Settings, so that the removed workflow surface cannot be reached indirectly.
6. As a Ticketry user, I want no state rename, group, color, reorder, or delete controls in Settings, so that the whole state catalog surface is consistently hidden.
7. As a Ticketry user, I want no start-state, transition, launch-policy, or workflow-membership controls in Settings, so that the whole issue-type workflow surface is consistently hidden.
8. As a Ticketry user, I want existing model configuration values to appear when Settings opens, so that removing Workflow does not diminish model configuration.
9. As a Ticketry user, I want provider and model validation feedback to remain visible, so that I can correct invalid model configuration.
10. As a Ticketry user, I want unsaved model changes to remain clearly counted, so that I know whether Settings contains pending work.
11. As a Ticketry user, I want to discard unsaved model changes, so that I can return to the confirmed configuration.
12. As a Ticketry user, I want to save model changes, so that the configured defaults and provider choices take effect.
13. As a Ticketry user, I want model save success and failure feedback to remain available, so that I know whether my action completed.
14. As a Ticketry user, I want Settings to retain its existing close and keyboard-focus behavior, so that the narrower dialog remains accessible and predictable.
15. As a Ticketry user, I want state-header configuration elsewhere in Studio to remain available, so that hiding global workflow settings does not remove state-scoped launch and transition controls.
16. As a maintainer, I want opening Settings to avoid loading project workflow catalogs, so that a model-only surface does not perform unrelated requests or depend on a selected project.
17. As a maintainer, I want the acceptance suite to describe Settings as model-only, so that the removed Workflow group cannot be accidentally reintroduced.

## Implementation Decisions

* The global Settings dialog has one user-visible section: `Models`.
* Remove the Workflow rail group and both of its entries, `States` and `Issue types`.
* Models is the initial and only active Settings content. No user action is required to select it after opening the dialog.
* Do not expose the currently unreachable Keyboard section as part of this change. The clarified requirement is that only Models remains in Settings.
* Preserve the existing Settings dialog shell, close behavior, focus trap, status presentation, model configuration panel, unsaved-change count, Discard action, and Save changes action.
* Remove Settings-dialog state and rendering branches that exist only to switch among workflow and model sections. A one-section dialog must not retain a hidden route that can activate Workflow content.
* Stop the Settings dialog from subscribing to workflow-editor catalog, action, notice, and error state solely for the removed sections.
* Stop lazy-loading or mounting the workflow settings panel from the Settings dialog.
* Opening Settings must not trigger project state, issue-type, work-item-count, or issue-type workflow-policy reads. Model capability/configuration loading continues through the existing model configuration boundary.
* Preserve model-related applied/pending change reporting. If the existing applied-changes ledger remains in the dialog composition, it reports model changes only and must not require workflow-editor state.
* Keep the state catalog, issue-type workflow editor, workflow store operations, API client methods, and backend endpoints intact unless ordinary dead-code analysis proves a frontend-only adapter has no consumer after the Settings entry point is removed.
* Preserve the state-scoped configuration panel opened from a state header in the task list. Its workflow policy, launch binding, transition permission, and automation behavior are not part of the global Settings removal.
* Do not change persisted workflow or model data. No schema, migration, generated SDK, backend, or MCP contract change is required.
* Use the repository's existing terms `Settings`, `Models`, `Workflow`, `States`, `Issue types`, `state catalog`, and `state configuration` consistently.

## Testing Decisions

* Test the change at the highest existing seam: render the Studio footer and modal host, open Settings through the user-visible `Open Settings` action, and assert the resulting dialog's observable content and requests. Do not test component-local section state or lazy-import implementation details.
* Update the numbered Studio settings acceptance case in the existing `studio/src/test/*Acceptance.test.tsx` suite. The case must prove that a cold-open renders the `Models` heading/content directly.
* At that same acceptance seam, assert that the Workflow group and the `States` and `Issue types` tabs are absent.
* Assert that state-catalog controls such as the State catalog region and state creation/editing controls are absent.
* Assert that opening Settings does not call the mocked project issue-type, state, work-item, or workflow-settings APIs.
* Preserve or extend existing model configuration tests for loading, validation, unsaved-change counting, discard, successful save, and failed save behavior. Those tests are prior art for the surviving Settings content.
* Preserve the dialog-shell assertions that cover closing, Escape handling, and focus containment where already present; the one-section composition must not regress them.
* Existing acceptance and component tests for state-header configuration remain unchanged and serve as regression coverage that the separate state-scoped surface still works.
* Run the mandatory numbered overhaul gate with `npm run test:overhaul --workspace @worktracker/studio` before implementation handoff.

## Out of Scope

* Creating implementation tickets or child work items during the Spec stage.
* Deleting states, issue types, workflow policies, launch bindings, or any existing project data.
* Removing or changing backend state and workflow APIs, MCP tools, database models, or generated SDK contracts.
* Removing the state-scoped configuration panel reached from state headers in the task list.
* Redesigning the Models panel, changing provider/model semantics, or changing save and discard behavior.
* Reintroducing or redesigning keyboard-shortcut configuration.
* Replacing Settings with a new navigation destination or changing how the footer opens and closes it.
* Adding a new workflow-management location to compensate for the removed global Settings surface.

## Further Notes

* The implementation should distinguish hiding the global Workflow section from deleting workflow capability. Workflow data remains necessary for task grouping, state transitions, agent launch policy, and state-scoped configuration elsewhere in Studio.
* The current Settings acceptance case cold-opens onto the State catalog. It is the canonical acceptance seam to rewrite around the model-only outcome.
* No new architectural decision record is required: this removes one presentation entry point without introducing a durable cross-boundary decision or changing an existing domain contract.