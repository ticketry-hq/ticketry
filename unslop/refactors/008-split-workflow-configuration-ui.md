# IssueTypesSection contains several independently editable controls

Priority: P2. Effort: Small. Category: Guideline violation and maintainability.

## Evidence

- [studio/src/features/workflows/IssueTypesSection.tsx](../../studio/src/features/workflows/IssueTypesSection.tsx), line 31, `export function IssueTypesSection`.
- [studio/src/features/workflows/IssueTypesSection.tsx](../../studio/src/features/workflows/IssueTypesSection.tsx), line 404, `function TransitionDisclosure`.
- [studio/src/features/workflows/IssueTypesSection.tsx](../../studio/src/features/workflows/IssueTypesSection.tsx), line 708, `function WorkflowImpactDialog`.

## Why change it

This 773-line file combines issue-type selection, transition controls, state launch configuration, destination selection, impact confirmation, and validation helpers. Several are already named components with explicit inputs, but all live in one file. This exceeds the roughly 300 to 400 line guidance and mixes concerns that developers commonly change separately.

## Smallest useful refactor

Extract TransitionDisclosure, StateLaunchConfiguration, and WorkflowImpactDialog into focused files under the workflow feature. Move their private helpers with them. Keep IssueTypesSection responsible for selection and composition. Avoid a generic form framework.

## Validation

Run the existing workflow and settings tests after moving code. This should preserve behavior and public imports. If a control changes behavior during the extraction, add or update its Studio acceptance case and run the overhaul gate.
