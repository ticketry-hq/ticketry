import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../shared/api/errors";
import { DescriptorSettingHarness } from "./DescriptorSettingHarness";
import type { ReviewerSetting } from "./descriptorSettingDefinition";

const stored: ReviewerSetting = { displayName: "Release desk", notifyOnSave: true };

type HarnessProps = ComponentProps<typeof DescriptorSettingHarness>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/**
 * Renders the harness over a stub authoritative value. `update` stands in for
 * the Apollo read delivering a new authoritative value or identity.
 */
function renderSetting(initial: Partial<HarnessProps> = {}) {
  let props: HarnessProps = {
    identity: "reviewer",
    authoritative: stored,
    save: async (draft) => draft,
    ...initial,
  };
  const view = render(<DescriptorSettingHarness {...props} />);
  return {
    update(next: Partial<HarnessProps>) {
      props = { ...props, ...next };
      view.rerender(<DescriptorSettingHarness {...props} />);
    },
  };
}

/**
 * A save binding whose calls stay in flight until the test settles them; a
 * successful settle also publishes the saved value as the new authoritative
 * value, as a binding writing the Apollo read would.
 */
function deferredSaves(publish?: (saved: ReviewerSetting) => void) {
  const calls: Array<{ sent: ReviewerSetting; reply: Deferred<ReviewerSetting> }> = [];
  const save = vi.fn((sent: ReviewerSetting) => {
    const reply = deferred<ReviewerSetting>();
    calls.push({ sent, reply });
    return reply.promise;
  });
  return {
    calls,
    save,
    async succeed(index: number, saved = calls[index]!.sent) {
      await act(async () => {
        publish?.(saved);
        calls[index]!.reply.resolve(saved);
        await calls[index]!.reply.promise;
      });
    },
    async fail(index: number, error: unknown) {
      await act(async () => {
        calls[index]!.reply.reject(error);
        await calls[index]!.reply.promise.catch(() => undefined);
      });
    },
  };
}

function typeName(value: string) {
  fireEvent.change(displayName(), { target: { value } });
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Save" });
}

async function clickSave() {
  await act(async () => {
    fireEvent.click(saveButton());
  });
}

function discardButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Discard" });
}

function displayName(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Reviewer display name" });
}

function notify(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: "Notify reviewers on save" });
}

describe("settings editor lifecycle, through a descriptor-only setting", () => {
  it("renders every declared field with its accessible name and the stored value", () => {
    renderSetting();

    expect(displayName()).toHaveValue("Release desk");
    expect(displayName()).toHaveAttribute("maxLength", "24");
    expect(screen.getByRole("heading", { name: "Display name" })).toBeInTheDocument();
    expect(screen.getByText("Shown next to every review you leave.")).toBeInTheDocument();
    expect(screen.getByText("12 / 24")).toBeInTheDocument();
    expect(notify()).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("enables Save and Discard only while the draft differs from the stored value", () => {
    renderSetting();

    typeName("Release crew");
    expect(saveButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
    expect(screen.getByText("12 / 24")).toBeInTheDocument();

    fireEvent.click(notify());
    expect(notify()).not.toBeChecked();
    expect(saveButton()).toBeEnabled();
  });

  it("shows the first validation message and blocks Save until it is fixed", async () => {
    const saves = deferredSaves();
    renderSetting({ save: saves.save });

    typeName("  ");
    expect(screen.getByText("Display name is required.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    typeName("QA");
    expect(screen.getByText(
      "Notified reviewers need a display name of at least 3 characters.",
    )).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    fireEvent.click(notify());
    expect(screen.queryByText(/Notified reviewers need/)).not.toBeInTheDocument();
    await clickSave();
    expect(saves.save).toHaveBeenCalledTimes(1);
  });

  it("saves the draft and shows the authoritative saved value, clean", async () => {
    const setting = renderSetting();
    const saves = deferredSaves((saved) => setting.update({ authoritative: saved }));
    setting.update({ save: saves.save });

    typeName("  Release crew");
    await clickSave();
    expect(saves.calls.map((call) => call.sent)).toEqual([
      { displayName: "  Release crew", notifyOnSave: true },
    ]);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    // The server trims; the editor shows what was stored, not what was typed.
    await saves.succeed(0, { displayName: "Release crew", notifyOnSave: true });

    expect(displayName()).toHaveValue("Release crew");
    expect(screen.getByText("Reviewer settings saved.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
  });

  it("keeps an edit made while a save is in flight dirty after the save lands", async () => {
    const setting = renderSetting();
    const saves = deferredSaves((saved) => setting.update({ authoritative: saved }));
    setting.update({ save: saves.save });

    typeName("Release crew");
    await clickSave();
    typeName("Release crew two");

    await saves.succeed(0);

    expect(displayName()).toHaveValue("Release crew two");
    expect(saveButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();

    // Discard now returns to what the first save stored, not the original.
    fireEvent.click(discardButton());
    expect(displayName()).toHaveValue("Release crew");
  });

  it("keeps the draft and shows the server's reason when a save fails", async () => {
    const saves = deferredSaves();
    renderSetting({ save: saves.save });

    typeName("Release crew");
    await clickSave();
    await saves.fail(0, new ApiError(422, "HTTP 422", {
      detail: [{ msg: "display name is reserved" }, { msg: "try another" }],
    }));

    expect(screen.getByRole("alert")).toHaveTextContent("display name is reserved; try another");
    expect(displayName()).toHaveValue("Release crew");
    expect(saveButton()).toBeEnabled();

    // Editing clears the stale failure; a retry sends the kept draft.
    typeName("Release crew!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await clickSave();
    expect(saves.calls[1]!.sent).toEqual({ displayName: "Release crew!", notifyOnSave: true });
  });

  it("discards back to the stored value", () => {
    renderSetting();

    typeName("Release crew");
    fireEvent.click(notify());
    fireEvent.click(discardButton());

    expect(displayName()).toHaveValue("Release desk");
    expect(notify()).toBeChecked();
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
  });

  it("resets the draft to the next record's stored value when the identity changes", () => {
    const setting = renderSetting();

    typeName("Unsaved for desk");
    setting.update({
      identity: "reviewer:other",
      authoritative: { displayName: "Night shift", notifyOnSave: false },
    });

    expect(displayName()).toHaveValue("Night shift");
    expect(notify()).not.toBeChecked();
    expect(saveButton()).toBeDisabled();
  });

  it("lets a save that lands after an identity switch leave the new record untouched", async () => {
    const saves = deferredSaves();
    const setting = renderSetting({ save: saves.save });

    typeName("Release crew");
    await clickSave();
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    setting.update({
      identity: "reviewer:other",
      authoritative: { displayName: "Night shift", notifyOnSave: true },
    });
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    // The new record's draft now equals what the old record sent, so only the
    // identity tells the late completion apart.
    typeName("Release crew");

    await saves.succeed(0);

    expect(displayName()).toHaveValue("Release crew");
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText("Reviewer settings saved.")).not.toBeInTheDocument();
  });

  it("hydrates an editor mounted before its stored value arrived", () => {
    const setting = renderSetting({ authoritative: undefined, loading: true });
    expect(displayName()).toHaveValue("");
    expect(displayName()).toBeDisabled();

    setting.update({ authoritative: stored, loading: false });

    expect(displayName()).toHaveValue("Release desk");
    expect(displayName()).toBeEnabled();
    expect(saveButton()).toBeDisabled();
  });

  it("follows a later stored change while clean and protects a dirty draft", () => {
    const setting = renderSetting();

    setting.update({ authoritative: { displayName: "Changed elsewhere", notifyOnSave: true } });
    expect(displayName()).toHaveValue("Changed elsewhere");
    expect(saveButton()).toBeDisabled();

    typeName("Still typing");
    setting.update({ authoritative: { displayName: "Changed again", notifyOnSave: false } });
    expect(displayName()).toHaveValue("Still typing");
    expect(notify()).toBeChecked();
    expect(saveButton()).toBeEnabled();

    fireEvent.click(discardButton());
    expect(displayName()).toHaveValue("Changed again");
    expect(notify()).not.toBeChecked();
  });

  it("autosaves a burst one write at a time and sends the newest value last", async () => {
    const setting = renderSetting({ mode: "autosave" });
    const saves = deferredSaves((saved) => setting.update({ authoritative: saved }));
    setting.update({ save: saves.save });

    await act(async () => {
      typeName("R");
      typeName("Re");
      typeName("Rel");
    });
    expect(saves.calls.map((call) => call.sent.displayName)).toEqual(["R"]);
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    await act(async () => {
      typeName("Rele");
      typeName("Release");
    });
    await saves.succeed(0);

    // Only the newest queued value is sent, after the first write finished.
    expect(saves.calls.map((call) => call.sent.displayName)).toEqual(["R", "Release"]);
    expect(displayName()).toHaveValue("Release");
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    await saves.succeed(1);

    expect(saves.save).toHaveBeenCalledTimes(2);
    expect(displayName()).toHaveValue("Release");
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    expect(screen.getByText("Reviewer settings saved.")).toBeInTheDocument();
  });
});
