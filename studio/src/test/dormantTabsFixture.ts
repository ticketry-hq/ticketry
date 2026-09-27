import { fireEvent, screen, waitFor } from "@testing-library/react";

// Dormant runs and closed documents live behind the tab strip's "↻ Resume"
// dropdown. These open it (when present and closed) before looking inside.

export function openDormantTabs(): void {
  const trigger = screen.queryByTestId("dormant-tabs-trigger");
  if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(trigger);
  }
}

export function getDormantItem(name: string | RegExp): HTMLElement {
  openDormantTabs();
  return screen.getByRole("menuitem", { name });
}

export function queryDormantItem(name: string | RegExp): HTMLElement | null {
  openDormantTabs();
  return screen.queryByRole("menuitem", { name });
}

export function findDormantItem(name: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => getDormantItem(name));
}
