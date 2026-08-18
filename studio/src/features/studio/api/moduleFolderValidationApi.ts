import { authenticatedHostFetch } from "../../../shared/api/authenticatedHostFetch";

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
  const response = await authenticatedHostFetch("/api/config/folders/validate", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    throw new Error(`module folder validation failed (HTTP ${response.status})`);
  }
  return (await response.json()) as ModuleFolderValidation;
}
