import { useEffect, useRef, useState } from "react";

export const SELECTION_DELAY_MS = 500;

export function useDelayedSelectionId(
  id: string | null,
  delayMs: number,
): string | null {
  const selectionRef = useRef({ id, delayMs, revision: 0 });
  if (
    selectionRef.current.id !== id ||
    selectionRef.current.delayMs !== delayMs
  ) {
    selectionRef.current = {
      id,
      delayMs,
      revision: selectionRef.current.revision + 1,
    };
  }
  const selection = selectionRef.current;
  const [readyRevision, setReadyRevision] = useState<number | null>(
    delayMs > 0 ? null : selection.revision,
  );

  useEffect(() => {
    if (delayMs <= 0) return;
    if (id === null) {
      setReadyRevision(null);
      return;
    }

    const timer = window.setTimeout(
      () => setReadyRevision(selection.revision),
      delayMs,
    );
    return () => window.clearTimeout(timer);
  }, [delayMs, id, selection.revision]);

  if (delayMs <= 0) return id;
  return readyRevision === selection.revision ? id : null;
}
