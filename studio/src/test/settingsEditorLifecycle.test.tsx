import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../shared/api/errors";
import { DescriptorEditor, type SaveMode } from "../shared/editorLifecycle";
import { digestSettingEditor, type DigestSetting } from "./digestSettingFixture";

// Seam 2 of CODING-2729: a test-only setting rendered from declarations only.
// The host below stands in for an Apollo watched read (`records`, `loading`,
// `loadError`) and a save binding whose responses the test resolves by hand.

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface SaveCall {
  identity: string;
  value: DigestSetting;
  response: Deferred<DigestSetting | null>;
}

interface HostControls {
  saves: SaveCall[];
  setRecord: (identity: string, value: DigestSetting | undefined) => void;
  setIdentity: (identity: string) => void;
  setLoadError: (error: unknown) => void;
}

function renderDigestEditor({
  records = { alpha: { title: "Weekly", shared: false } },
  identity: initialIdentity = "alpha",
  mode = "commit",
}: {
  records?: Record<string, DigestSetting | undefined>;
  identity?: string;
  mode?: SaveMode;
} = {}): HostControls {
  const controls = { saves: [] } as unknown as HostControls;

  function Host() {
    const [store, setStore] = useState(records);
    const [identity, setIdentity] = useState(initialIdentity);
    const [loadError, setLoadError] = useState<unknown>(undefined);
    controls.setRecord = (key, value) =>
      setStore((current) => ({ ...current, [key]: value }));
    controls.setIdentity = setIdentity;
    controls.setLoadError = setLoadError;
    const authoritative = store[identity];
    const save = async (value: DigestSetting) => {
      const response = deferred<DigestSetting | null>();
      controls.saves.push({ identity, value, response });
      const saved = await response.promise;
      // The binding owns cache effects: its response becomes the read. `null`
      // is a write that did not land, which leaves the read alone.
      if (saved) setStore((current) => ({ ...current, [identity]: saved }));
      return saved;
    };
    return (
      <DescriptorEditor
        definition={digestSettingEditor}
        identity={identity}
        authoritative={authoritative}
        loading={authoritative === undefined && loadError === undefined}
        loadError={loadError}
        mode={mode}
        save={save}
      />
    );
  }

  render(<Host />);
  return controls;
}

const TWO_RECORDS = {
  alpha: { title: "Weekly", shared: false },
  beta: { title: "Team", shared: true },
};

const titleField = () => screen.getByRole("textbox", { name: "Digest title" });
const sharedField = () =>
  screen.getByRole("checkbox", { name: "Share digest with the team" });
const saveButton = () =>
  screen.getByRole("button", { name: "Save digest settings" });
const discardButton = () => screen.getByRole("button", { name: "Discard" });

/** Edits the title, presses Save, and settles the first save with `settle`. */
async function saveTitleAndSettle(
  host: HostControls,
  settle: (response: Deferred<DigestSetting | null>) => void,
) {
  fireEvent.change(titleField(), { target: { value: "Monthly" } });
  fireEvent.click(saveButton());
  await act(async () => settle(host.saves[0].response));
}

describe("settings editor lifecycle through a descriptor-only setting", () => {
  it("renders every declared field with its accessible name", () => {
    renderDigestEditor();

    expect(titleField()).toHaveValue("Weekly");
    expect(titleField()).toHaveAttribute("maxlength", "40");
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Shown at the top of every digest.")).toBeInTheDocument();
    expect(screen.getByText("6 / 40")).toBeInTheDocument();
    expect(sharedField()).not.toBeChecked();
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
  });

  it("tracks dirty input and enables Save and Discard only while it differs", () => {
    renderDigestEditor();

    fireEvent.change(titleField(), { target: { value: "Monthly" } });
    expect(saveButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
    expect(screen.getByText("7 / 40")).toBeInTheDocument();

    fireEvent.change(titleField(), { target: { value: "Weekly" } });
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
  });

  it("blocks saving with the field message, then the record message", () => {
    const host = renderDigestEditor();

    fireEvent.change(titleField(), { target: { value: " " } });
    expect(screen.getByRole("alert")).toHaveTextContent("A digest title is required.");
    expect(saveButton()).toBeDisabled();

    fireEvent.change(titleField(), { target: { value: "Hi" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A digest title needs at least 3 characters.",
    );
    expect(saveButton()).toBeDisabled();

    fireEvent.change(titleField(), { target: { value: "Private" } });
    fireEvent.click(sharedField());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A shared digest cannot be titled “private”.",
    );
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(host.saves).toHaveLength(0);
  });

  it("adopts the authoritative value a successful save returns", async () => {
    const host = renderDigestEditor();

    fireEvent.change(titleField(), { target: { value: "  Monthly " } });
    fireEvent.click(saveButton());
    expect(saveButton()).toHaveTextContent("Saving…");
    expect(saveButton()).toBeDisabled();
    expect(host.saves.map((call) => call.value)).toEqual([
      { title: "  Monthly ", shared: false },
    ]);

    await act(async () => {
      host.saves[0].response.resolve({ title: "Monthly", shared: false });
    });

    expect(titleField()).toHaveValue("Monthly");
    expect(screen.getByRole("status")).toHaveTextContent("Digest settings saved.");
    expect(saveButton()).toHaveTextContent("Save changes");
    expect(saveButton()).toBeDisabled();
  });

  it("keeps an edit made during an in-flight save pending afterwards", async () => {
    const host = renderDigestEditor();

    fireEvent.change(titleField(), { target: { value: "Monthly" } });
    fireEvent.click(saveButton());
    expect(titleField()).toBeEnabled();
    fireEvent.change(titleField(), { target: { value: "Monthly recap" } });
    fireEvent.click(saveButton());
    expect(host.saves).toHaveLength(1);

    await act(async () => {
      host.saves[0].response.resolve({ title: "Monthly", shared: false });
    });

    expect(titleField()).toHaveValue("Monthly recap");
    expect(saveButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
  });

  it("keeps the draft and shows the server reason when a save fails", async () => {
    const host = renderDigestEditor();

    await saveTitleAndSettle(host, (response) =>
      response.reject(
        new ApiError(422, "HTTP 422", {
          detail: [{ msg: "title is reserved" }, { msg: "pick another" }],
        }),
      ));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "title is reserved; pick another",
    );
    expect(titleField()).toHaveValue("Monthly");
    expect(titleField()).toBeEnabled();
    expect(saveButton()).toBeEnabled();

    fireEvent.change(titleField(), { target: { value: "Monthly digest" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports nothing saved when the binding says the write did not land", async () => {
    const host = renderDigestEditor();

    await saveTitleAndSettle(host, (response) => response.resolve(null));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(titleField()).toHaveValue("Monthly");
    expect(saveButton()).toBeEnabled();
  });

  it("discards back to the current authoritative value", () => {
    const host = renderDigestEditor();

    fireEvent.change(titleField(), { target: { value: "Monthly" } });
    fireEvent.click(sharedField());
    act(() => host.setRecord("alpha", { title: "Daily", shared: false }));
    fireEvent.click(discardButton());

    expect(titleField()).toHaveValue("Daily");
    expect(sharedField()).not.toBeChecked();
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
  });

  it("resets the draft when the edited record changes", () => {
    const host = renderDigestEditor({ records: TWO_RECORDS });

    fireEvent.change(titleField(), { target: { value: "Monthly" } });
    act(() => host.setIdentity("beta"));

    expect(titleField()).toHaveValue("Team");
    expect(sharedField()).toBeChecked();
    expect(saveButton()).toBeDisabled();
  });

  it("leaves the new record untouched when a late save for the old one lands", async () => {
    const host = renderDigestEditor({ records: TWO_RECORDS });

    fireEvent.change(titleField(), { target: { value: "Monthly" } });
    fireEvent.click(saveButton());
    act(() => host.setIdentity("beta"));
    expect(saveButton()).toHaveTextContent("Save changes");
    fireEvent.change(titleField(), { target: { value: "Team notes" } });

    await act(async () => {
      host.saves[0].response.resolve({ title: "Monthly", shared: false });
    });

    expect(titleField()).toHaveValue("Team notes");
    expect(sharedField()).toBeChecked();
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => host.setIdentity("alpha"));
    expect(titleField()).toHaveValue("Monthly");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hydrates an editor mounted before its value arrives", () => {
    const host = renderDigestEditor({ records: { alpha: undefined } });

    expect(titleField()).toHaveValue("");
    expect(titleField()).toBeDisabled();
    expect(saveButton()).toBeDisabled();

    act(() => host.setRecord("alpha", { title: "Weekly", shared: true }));

    expect(titleField()).toHaveValue("Weekly");
    expect(titleField()).toBeEnabled();
    expect(sharedField()).toBeChecked();
    expect(saveButton()).toBeDisabled();

    fireEvent.change(titleField(), { target: { value: "Weekly recap" } });
    expect(saveButton()).toBeEnabled();
  });

  it("reports a failed load with the declared wording", () => {
    const host = renderDigestEditor({ records: { alpha: undefined } });

    act(() => host.setLoadError(new Error("offline")));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Digest settings could not be loaded.",
    );
    expect(saveButton()).toBeDisabled();
  });

  it("follows a later authoritative change while clean and keeps a dirty draft", () => {
    const host = renderDigestEditor();

    act(() => host.setRecord("alpha", { title: "Daily", shared: false }));
    expect(titleField()).toHaveValue("Daily");

    fireEvent.change(titleField(), { target: { value: "Daily recap" } });
    act(() => host.setRecord("alpha", { title: "Hourly", shared: true }));

    expect(titleField()).toHaveValue("Daily recap");
    expect(sharedField()).not.toBeChecked();
    expect(saveButton()).toBeEnabled();
  });

  it("serializes an autosave burst and sends the newest value last", async () => {
    const host = renderDigestEditor({ mode: "autosave" });
    expect(screen.queryByRole("button", { name: "Save digest settings" }))
      .not.toBeInTheDocument();

    for (const title of ["A", "AB", "ABC"]) {
      fireEvent.change(titleField(), { target: { value: title } });
      fireEvent.blur(titleField());
    }
    await waitFor(() => expect(host.saves).toHaveLength(1));
    expect(screen.getByText("Applying…")).toBeInTheDocument();
    expect(host.saves[0].value.title).toBe("A");

    await act(async () => {
      host.saves[0].response.resolve({ title: "A", shared: false });
    });
    await waitFor(() => expect(host.saves).toHaveLength(2));
    expect(host.saves[1].value.title).toBe("ABC");
    expect(titleField()).toHaveValue("ABC");

    await act(async () => {
      host.saves[1].response.resolve({ title: "ABC", shared: false });
    });
    expect(host.saves).toHaveLength(2);
    expect(titleField()).toHaveValue("ABC");
    expect(screen.queryByText("Applying…")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Digest settings saved.");
  });
});

