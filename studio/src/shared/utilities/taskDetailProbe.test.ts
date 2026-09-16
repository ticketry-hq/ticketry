import { afterEach, expect, it, vi } from "vitest";
import {
  beginTaskDetail,
  beginTaskDetailFromClick,
  beginTaskDetailModuleInput,
  recordTaskDetailClick,
  recordTaskSelection,
  taskDetailPoint,
} from "./taskDetailProbe";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("records long detail delays once per milestone and keeps late imports on their task", () => {
  vi.stubEnv("MODE", "development");
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  beginTaskDetail("a", "task-selection");
  const pendingImport = taskDetailPoint("a");
  now = 5_000;
  pendingImport("description-committed");
  pendingImport("description-committed");
  expect(log).toHaveBeenCalledTimes(2);
  expect(JSON.parse(log.mock.calls[1]![1])).toMatchObject({ task_id: "a", elapsed_ms: 5_000 });
  beginTaskDetail("b", "task-selection");
  pendingImport("description-import-ready");
  expect(JSON.parse(log.mock.calls.at(-1)![1])).toMatchObject({ task_id: "a", stage: "description-import-ready" });
  const count = log.mock.calls.length;
  taskDetailPoint("a")("description-paint-opportunity");
  expect(log).toHaveBeenCalledTimes(count);
});

it("clears selection for a module switch and stays disabled in production", () => {
  vi.stubEnv("MODE", "development");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  beginTaskDetail("a", "task-selection");
  beginTaskDetail(null, "module-switch");
  taskDetailPoint("a")("description-committed");
  expect(log).toHaveBeenCalledTimes(1);
  vi.stubEnv("DEV", false);
  beginTaskDetail("production", "task-selection");
  taskDetailPoint("production")("description-committed");
  expect(log).toHaveBeenCalledTimes(1);
});

it("keeps physical input through click and workspace selection, scoped to a session", () => {
  vi.stubEnv("MODE", "development");
  let now = 40;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  beginTaskDetailFromClick("clicked", 25);
  now = 42;
  recordTaskDetailClick("clicked", 41);
  now = 44;
  recordTaskSelection("clicked", "workspace-store");
  now = 75;
  taskDetailPoint("clicked")("description-view-interactable");
  expect(log).toHaveBeenCalledTimes(4);
  expect(JSON.parse(log.mock.calls[0]![1])).toMatchObject({
    task_id: "clicked", stage: "task-pointer-input", elapsed_ms: 15, event_to_handler_ms: 15,
  });
  expect(JSON.parse(log.mock.calls[1]![1])).toMatchObject({
    task_id: "clicked", stage: "task-click", elapsed_ms: 17, event_to_handler_ms: 1,
    click_elapsed_ms: 17, elapsed_origin: "task-pointer-input",
  });
  expect(JSON.parse(log.mock.calls[2]![1])).toMatchObject({
    task_id: "clicked", stage: "task-selection-dispatched", elapsed_ms: 19,
  });
  expect(JSON.parse(log.mock.calls[3]![1])).toMatchObject({
    task_id: "clicked", stage: "description-view-interactable", elapsed_ms: 50,
  });
  expect(JSON.parse(log.mock.calls[0]![1]).session_id).toEqual(expect.any(String));
});

it("does not reuse a consumed click trace for another selection of the same task", () => {
  vi.stubEnv("MODE", "development");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  beginTaskDetailFromClick("same", 0);
  recordTaskDetailClick("same", 0);
  recordTaskSelection("same", "workspace-store");
  recordTaskSelection("same", "workspace-store");
  const entries = log.mock.calls.map((call) => JSON.parse(call[1]));
  expect(entries.map((entry) => entry.stage)).toEqual([
    "task-pointer-input", "task-click", "task-selection-dispatched", "task-selection",
  ]);
  expect(entries[3]).toMatchObject({ elapsed_origin: "task-selection" });
});

it("clamps a future event timestamp to the handler time", () => {
  vi.stubEnv("MODE", "development");
  vi.spyOn(performance, "now").mockReturnValue(50);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  beginTaskDetailFromClick("future", 70);
  expect(JSON.parse(log.mock.calls[0]![1])).toMatchObject({ elapsed_ms: 0, event_to_handler_ms: 0 });
});

it("uses module selection entry as the restored task's origin", () => {
  vi.stubEnv("MODE", "development");
  let now = 10;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  beginTaskDetailModuleInput("module-selection");
  now = 510;
  beginTaskDetail("restored", "module-restoration");
  expect(JSON.parse(log.mock.calls[0]![1])).toMatchObject({
    task_id: "restored", stage: "task-selection", elapsed_ms: 500,
    source: "module-restoration", origin_source: "module-selection",
  });
});
