import { invoke, isTauri } from "@tauri-apps/api/core";

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
  if (isTauri()) {
    return invoke<ModuleFolderValidation>("desktop_validate_module_folder", { path });
  }
  return path.startsWith("/")
    ? { valid: true, reason: null }
    : { valid: false, reason: "module_folder_not_absolute" };
}
