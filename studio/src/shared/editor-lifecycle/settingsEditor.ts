import {
  useEditorLifecycle,
  type EditorLifecycle,
  type EditorLifecycleOptions,
} from "./editorLifecycle";
import {
  firstValidationMessage,
  type SettingsEditorDefinition,
} from "./fieldDescriptors";

type DefinedOptions<Draft> = Omit<
  EditorLifecycleOptions<Draft>,
  "empty" | "equals" | "validate"
>;

/** The editor lifecycle for an ordinary setting declared by a definition. */
export function useSettingsEditor<Draft>(
  definition: SettingsEditorDefinition<Draft>,
  options: DefinedOptions<Draft>,
): EditorLifecycle<Draft> {
  return useEditorLifecycle({
    ...options,
    empty: definition.empty,
    equals: definition.equals,
    validate: (draft) => firstValidationMessage(definition, draft),
  });
}
