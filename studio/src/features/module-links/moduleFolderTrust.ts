import type { StudioRuntime } from "../../runtime";
import { studioRuntime } from "../../runtime";

class ModuleFolderTrustError extends Error {}

function trustError(cause: unknown): ModuleFolderTrustError {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string" && cause.trim()
        ? cause
        : "Could not prepare Gemini folder trust. Retry to continue.";
  return new ModuleFolderTrustError(message);
}

/** Trust the folder when the desktop requires it. */
export async function prepareModuleFolderTrust(
  path: string,
  runtime: StudioRuntime = studioRuntime(),
): Promise<boolean> {
  if (runtime.prepareDirectoryTrust) {
    let result;
    try {
      result = await runtime.prepareDirectoryTrust("gemini", path, null);
    } catch (cause) {
      throw trustError(cause);
    }

    if (result.status === "approval_required") {
      const { dialog } = await import("../../state/clientStore");
      const approved = await dialog.confirm({
        title: "Trust this folder for Gemini?",
        body: `Gemini needs permission to trust ${path}.`,
        confirmLabel: "Trust folder",
      });
      if (!approved) return false;
      try {
        result = await runtime.prepareDirectoryTrust(
          "gemini",
          path,
          result.approval,
        );
      } catch (cause) {
        throw trustError(cause);
      }
    }

    if (result.status === "denied") {
      throw new ModuleFolderTrustError(
        "Gemini has denied trust for this folder.",
      );
    }
    if (result.status === "unsupported") {
      throw new ModuleFolderTrustError(
        "Gemini does not support durable folder trust.",
      );
    }
    if (result.status === "approval_required") {
      throw new ModuleFolderTrustError(
        "The folder changed before Gemini trust was saved. Retry to inspect it again.",
      );
    }
  }

  return true;
}

export function moduleFolderSaveError(cause: unknown, fallback: string): string {
  return cause instanceof ModuleFolderTrustError ? cause.message : fallback;
}
