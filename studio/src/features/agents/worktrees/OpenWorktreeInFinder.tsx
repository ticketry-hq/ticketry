import { useState } from "react";
import type { StudioRuntime } from "../../../runtime";
import { toast } from "../../../state/clientStore";

export type WorktreeRevealRuntime = Pick<
  StudioRuntime,
  "capabilities" | "revealInFileManager"
>;

interface OpenWorktreeInFinderProps {
  path: string | null | undefined;
  runtime: WorktreeRevealRuntime;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function OpenWorktreeInFinder({
  path,
  runtime,
}: OpenWorktreeInFinderProps) {
  const [opening, setOpening] = useState(false);

  if (!runtime.capabilities.nativeFileManager || !path) return null;

  const open = async () => {
    setOpening(true);
    try {
      await runtime.revealInFileManager(path);
    } catch (error) {
      toast.error(`Worktree could not be opened in Finder: ${errorMessage(error)}`);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      disabled={opening}
      onClick={() => void open()}
      className="text-text-secondary hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      {opening ? "Opening…" : "Open in Finder"}
    </button>
  );
}
