import { fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";

type Counts = Record<string, number>;

interface SelectionProfile {
  hotStoriesPaneModuleOpenWatchers: number;
  p50Ms: number;
  samples: Counts[];
}

const profileGlobal = globalThis as typeof globalThis & {
  __ticketrySelectionProfileProbe?: (point: string) => void;
};

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function profileSelection(size: 50 | 500): Promise<SelectionProfile> {
  const http = fixture();
  const moduleId = `profile-module-${size}`;
  const ids = Array.from({ length: size }, (_, index) => `profile-${size}-${index}`);
  http.tree(moduleId, {
    rootIds: ids,
    children: Object.fromEntries(ids.map((id) => [id, []])),
    order: ids,
  });
  http.workItems(ids.map((id, index) => workItem({
    id,
    name: `Profile item ${index}`,
    parent_id: moduleId,
    sequence_id: index + 1,
    rank: String(index).padStart(6, "0"),
  })));

  const counts: Counts = {};
  profileGlobal.__ticketrySelectionProfileProbe = (point) => {
    counts[point] = (counts[point] ?? 0) + 1;
  };

  const previousFetch = globalThis.fetch;
  const coldMount = mountStudio({ http, selectedTaskId: null });
  try {
    const storiesRegion = await within(coldMount.container).findByRole("region", {
      name: "Stories",
    });
    const tree = within(storiesRegion).getByRole("tree");
    await waitFor(() => {
      expect(tree.querySelector(`[data-task-id="${ids[0]}"]`)).not.toBeNull();
      expect(tree.querySelector(`[data-task-id="${ids[size - 1]}"]`)).not.toBeNull();
    });
  } finally {
    coldMount.unmount();
    globalThis.fetch = previousFetch;
  }

  for (const key of Object.keys(counts)) counts[key] = 0;
  const hotMount = mountStudio({
    http,
    selectedTaskId: null,
    graphQlExecution: false,
  });
  const hotStoriesPaneModuleOpenWatchers = counts["module-open-hook"] ?? 0;
  try {
    expect(hotStoriesPaneModuleOpenWatchers).toBe(1);

    const storiesRegion = within(hotMount.container).getByRole("region", {
      name: "Stories",
    });
    const tree = within(storiesRegion).getByRole("tree");
    const rowById = (id: string) => {
      const row = tree.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
      expect(row).not.toBeNull();
      return row!;
    };
    const first = rowById(ids[0]);
    const last = rowById(ids[size - 1]);

    fireEvent.click(last);
    expect(last).toHaveAttribute("aria-selected", "true");

    const durations: number[] = [];
    const samples: Counts[] = [];
    for (let index = 0; index < 12; index += 1) {
      for (const key of Object.keys(counts)) counts[key] = 0;
      const target = index % 2 === 0 ? first : last;
      const started = performance.now();
      fireEvent.click(target);
      durations.push(performance.now() - started);
      expect(target).toHaveAttribute("aria-selected", "true");
      samples.push({ ...counts });
    }

    return {
      hotStoriesPaneModuleOpenWatchers,
      p50Ms: percentile(durations, 0.5),
      samples,
    };
  } finally {
    hotMount.unmount();
    globalThis.fetch = previousFetch;
  }
}

afterEach(() => {
  delete profileGlobal.__ticketrySelectionProfileProbe;
});

describe("selection render regression gate", () => {
  it("[overhaul-205] keeps selection work flat as the visible row count grows", async () => {
    const fiftyRows = await profileSelection(50);
    const fiveHundredRows = await profileSelection(500);

    for (const profile of [fiftyRows, fiveHundredRows]) {
      expect(profile.hotStoriesPaneModuleOpenWatchers).toBe(1);
      expect(profile.samples.map((sample) => sample["task-row-render"])).toEqual(
        Array(12).fill(2),
      );
      expect(profile.samples.map((sample) => sample["visible-rows-build"] ?? 0)).toEqual(
        Array(12).fill(0),
      );
    }
    expect(fiveHundredRows.p50Ms).toBeLessThanOrEqual(fiftyRows.p50Ms * 1.5);
  }, 60_000);
});
