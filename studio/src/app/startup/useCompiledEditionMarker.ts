import { useEffect } from "react";
import { EDITION } from "../../shared/config/edition";

/**
 * Marks the document root with the frontend's compiled edition
 * (`data-ticketry-edition`) so browser and desktop e2e can reject a stale
 * frontend. Informational only: nothing reads the attribute back.
 */
export function useCompiledEditionMarker(): void {
  useEffect(() => {
    document.documentElement.dataset.ticketryEdition = EDITION;
  }, []);
}
