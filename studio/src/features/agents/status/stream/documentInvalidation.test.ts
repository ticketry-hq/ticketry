/**
 * Reading document facts, and converging exactly the registry they name.
 *
 * The two halves are tested together because they only mean anything together:
 * the reader's whole job is to produce the bucket the invalidator keys on, and
 * a fact that cannot name a bucket must converge nothing rather than everything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";
import type { RunStatusEventFrame } from "../generated/statusStream";
import { readStatusFact } from "./statusFacts";
import { createDocumentInvalidator, registryPrefix } from "./documentInvalidation";

const TASK = "33333333-3333-3333-3333-333333333333";
const MODULE = "44444444-4444-4444-4444-444444444444";

const frame = (
  event_kind: string,
  payload: Record<string, unknown>,
): RunStatusEventFrame =>
  ({
    __typename: "RunStatusEvent",
    cursor: 1,
    event_id: "event-1",
    project_id: "11111111-1111-1111-1111-111111111111",
    event_kind,
    payload_version: 1,
    subject_kind: "design_document",
    subject_id: "doc-1",
    agent_run_id: null,
    automation_attempt_id: null,
    work_item_id: null,
    payload,
    committed_at: "2026-08-17T10:00:00+00:00",
  }) as unknown as RunStatusEventFrame;

const taskPayload = {
  documentId: "doc-1",
  scope: "task",
  ownerId: TASK,
  moduleId: MODULE,
  relPath: "SPEC.md",
  changeKind: "created",
};

describe("reading a document fact", () => {
  it("names the bucket a consumer keys its registry by", () => {
    expect(readStatusFact(frame("document.changed", taskPayload))).toEqual({
      family: "document",
      scope: "task",
      ownerId: TASK,
      moduleId: MODULE,
      removed: false,
      documentId: "doc-1",
      relPath: "SPEC.md",
      changeKind: "created",
    });
  });

  it("distinguishes a removal from a change", () => {
    const fact = readStatusFact(
      frame("document.deleted", { ...taskPayload, changeKind: "deleted" }),
    );

    expect(fact).toMatchObject({ family: "document", removed: true });
  });

  it("reads a scratch bucket as the module that owns it", () => {
    const fact = readStatusFact(
      frame("document.changed", {
        ...taskPayload,
        scope: "scratch",
        ownerId: MODULE,
      }),
    );

    expect(fact).toMatchObject({ scope: "scratch", ownerId: MODULE });
  });

  it("skips a fact that cannot name its bucket rather than guessing at one", () => {
    // Refreshing every registry because one fact was unreadable would undo the
    // point of publishing the bucket at all.
    expect(readStatusFact(frame("document.changed", { relPath: "SPEC.md" }))).toBeNull();
    expect(
      readStatusFact(frame("document.changed", { ...taskPayload, scope: "everything" })),
    ).toBeNull();
  });
});

describe("converging a document registry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("refetches one bucket per window however many facts it received", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const invalidator = createDocumentInvalidator(50);

    for (let index = 0; index < 5; index += 1) {
      invalidator.record({ scope: "task", ownerId: TASK });
    }
    invalidator.record({ scope: "scratch", ownerId: MODULE });
    vi.advanceTimersByTime(50);

    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      registryPrefix({ scope: "task", ownerId: TASK }),
      registryPrefix({ scope: "scratch", ownerId: MODULE }),
    ]);
  });

  it("matches every read of one bucket without matching another bucket", () => {
    const prefix = registryPrefix({ scope: "task", ownerId: TASK });

    // The surface reads the registry with the project and module it happens to
    // hold; a fact cannot know those, so the key it invalidates stops short of
    // them and still matches the read.
    expect(
      queryKeys.documents.registry("task", TASK, "project-1", MODULE).slice(0, 4),
    ).toEqual(prefix);
    expect(queryKeys.documents.registry("scratch", MODULE).slice(0, 4)).not.toEqual(
      prefix,
    );
  });

  it("drops what is queued when the feed stops or switches project", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const invalidator = createDocumentInvalidator(50);

    invalidator.record({ scope: "task", ownerId: TASK });
    invalidator.cancel();
    vi.advanceTimersByTime(50);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
