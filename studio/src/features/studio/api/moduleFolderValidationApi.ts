import { validateModuleFolder as validateThroughSdk } from "../../../shared/api/client";

export type ModuleFolderRefusal =
  | "module_folder_not_absolute"
  | "module_folder_missing"
  | "module_folder_not_a_directory";

export interface ModuleFolderValidation {
  valid: boolean;
  reason: ModuleFolderRefusal | null;
}

export async function validateModuleFolder(
  path: string,
): Promise<ModuleFolderValidation> {
  return (await validateThroughSdk(path)) as ModuleFolderValidation;
}
