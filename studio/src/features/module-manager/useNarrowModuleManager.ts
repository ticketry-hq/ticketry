import { useEffect, useState } from "react";

const query = "(max-width: 760px)";

/** Responsive layout only; inspection and navigation state stay in Apollo. */
export function useNarrowModuleManager(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? window.innerWidth <= 760);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    const update = () => setNarrow(media?.matches ?? window.innerWidth <= 760);
    update();
    media?.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      media?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return narrow;
}
