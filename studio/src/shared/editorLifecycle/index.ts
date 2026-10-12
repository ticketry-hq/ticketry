// Shared settings editor lifecycle: draft, hydration, save and feedback for an
// editor over one authoritative value. See docs/feature-map/settings.md.
export { DescriptorEditor } from "./DescriptorEditor";
export { DescriptorFields } from "./DescriptorFields";
export type { DraftUpdate } from "./draftTracking";
export type {
  EditorLifecycle,
  EditorLifecycleOptions,
  EditorStatus,
  SaveMode,
  SaveOutcome,
} from "./editorLifecycle";
export { useEditorLifecycle } from "./editorLifecycle";
export type {
  CheckboxFieldDescriptor,
  EditorDefinition,
  EditorMessages,
  FieldDescriptor,
  TextFieldDescriptor,
  ValidationMessage,
} from "./fieldDescriptors";
export { validateDraft } from "./fieldDescriptors";
export { saveErrorMessage } from "./saveErrorMessage";
export type { SaveBinding } from "./saveSequencing";
