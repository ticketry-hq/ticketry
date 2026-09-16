import { afterEach, expect, it, vi } from "vitest";
import { resetStudioApolloClient } from "../../shared/apollo/client";
import {
  discardDescriptionDraft, editDescriptionDraft, openDescriptionDraft,
  saveDescriptionDraft, useDescriptionDrafts,
} from "./descriptionDrafts";

afterEach(() => resetStudioApolloClient());

it("saves newer edits queued by navigation after the current write settles", async () => {
  let release!: () => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
    .mockResolvedValue(undefined);
  openDescriptionDraft("story", "saved");
  editDescriptionDraft("story", "first");
  const pending = saveDescriptionDraft("story", save);
  editDescriptionDraft("story", "second");
  await saveDescriptionDraft("story", save, true);
  release();
  await pending;
  expect(save.mock.calls).toEqual([["first"], ["second"]]);
  expect(useDescriptionDrafts.getState().drafts.story).toBeUndefined();
});

it("does not clear a reopened draft when a discarded edit's request settles", async () => {
  let release!: () => void;
  openDescriptionDraft("story", "saved");
  editDescriptionDraft("story", "first");
  const pending = saveDescriptionDraft("story", () => new Promise<void>((resolve) => { release = resolve; }));
  discardDescriptionDraft("story");
  openDescriptionDraft("story", "saved");
  editDescriptionDraft("story", "keep this");
  release();
  await pending;
  expect(useDescriptionDrafts.getState().drafts.story.text).toBe("keep this");
});
