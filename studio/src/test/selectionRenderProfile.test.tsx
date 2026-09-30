import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";

type Counts = Record<string, number>;

const profileGlobal = globalThis as typeof globalThis & {
  __ticketrySelectionProfileProbe?: (point: string) => void;
};

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

afterEach(() => {
  delete profileGlobal.__ticketrySelectionProfileProbe;
});

describe("temporary selection render profile", () => {
  for (const size of [50, 100, 250, 500]) {
    it(`profiles ${size} visible work items`, async () => {
      const http = fixture();
      const ids = Array.from({ length: size }, (_, index) => `profile-${index}`);
      http.tree("module-1", {
        rootIds: ids,
        children: Object.fromEntries(ids.map((id) => [id, []])),
        order: ids,
      });
      http.workItems(ids.map((id, index) => workItem({
        id,
        name: `Profile item ${index}`,
        sequence_id: index + 1,
        rank: String(index).padStart(6, "0"),
      })));

      const counts: Counts = {};
      profileGlobal.__ticketrySelectionProfileProbe = (point) => {
        counts[point] = (counts[point] ?? 0) + 1;
      };

      mountStudio({ http, selectedTaskId: ids[0] });
      const storiesRegion = await screen.findByRole("region", { name: "Stories" });
      const tree = within(storiesRegion).getByRole("tree");
      const rowById = async (id: string) => await waitFor(() => {
        const row = tree.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
        expect(row).not.toBeNull();
        return row!;
      });
      const first = await rowById(ids[0]);
      const last = await rowById(ids[size - 1]);

      fireEvent.click(last);
      expect(last).toHaveAttribute("aria-selected", "true");

      const samples: Array<{ durationMs: number; counts: Counts }> = [];
      for (let index = 0; index < 12; index += 1) {
        for (const key of Object.keys(counts)) counts[key] = 0;
        const target = index % 2 === 0 ? first : last;
        const started = performance.now();
        fireEvent.click(target);
        const durationMs = performance.now() - started;
        expect(target).toHaveAttribute("aria-selected", "true");
        samples.push({ durationMs, counts: { ...counts } });
      }

      const durations = samples.map((sample) => sample.durationMs);
      const meanCounts = Object.fromEntries(
        Object.keys(samples[0]?.counts ?? {}).map((point) => [
          point,
          rounded(samples.reduce((sum, sample) => sum + (sample.counts[point] ?? 0), 0) / samples.length),
        ]),
      );
      console.log("SELECTION_PROFILE", JSON.stringify({
        size,
        p50Ms: rounded(percentile(durations, 0.5)),
        p95Ms: rounded(percentile(durations, 0.95)),
        maxMs: rounded(Math.max(...durations)),
        meanCounts,
      }));
    }, 60_000);
  }
});
