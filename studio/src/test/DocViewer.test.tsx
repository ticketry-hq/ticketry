import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DocViewer from "../app/shell/ticket-workspace/selected-ticket/documents/DocViewer";
import { WorkspaceDocument } from "../app/shell/ticket-workspace/selected-ticket/documents/WorkspaceDocument";
import type { DesignDoc } from "../features/agents/types";

const { confirmReload } = vi.hoisted(() => ({
  confirmReload: vi.fn(),
}));

vi.mock("../state/clientStore", () => ({
  dialog: { confirm: confirmReload },
}));

vi.mock("../app/shell/ticket-workspace/selected-ticket/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
    onParseError,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
    onParseError: (source: string) => void;
  }) => (
    <>
      <textarea
        data-testid="rich-markdown-editor"
        aria-label="Document content"
        defaultValue={markdown}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={() => onParseError(markdown)}>
        Trigger parse error
      </button>
    </>
  ),
}));

const markdownDoc: DesignDoc = {
  id: "doc-1",
  rel_path: "SPEC.MD",
  label: "SPEC",
};

describe("DocViewer", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    confirmReload.mockReset().mockResolvedValue(true);
  });

  it("fetches and safely renders Markdown documents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# Hello\n\n<script>alert('no')</script>\n\n[link](https://example.com)"),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocViewer doc={markdownDoc} />);

    expect(await screen.findByRole("heading", { name: "Hello" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-doc-frame")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/docs/doc-1/SPEC.MD"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refetches Markdown when its registry record changes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("# Version 1"))
      .mockResolvedValueOnce(new Response("# Version 2"));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<DocViewer doc={markdownDoc} />);
    expect(await screen.findByRole("heading", { name: "Version 1" })).toBeInTheDocument();

    rerender(<DocViewer doc={{ ...markdownDoc }} />);

    expect(await screen.findByRole("heading", { name: "Version 2" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("opens eligible Markdown in rich edit mode by default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# Editable", { headers: { ETag: '"revision-1"' } }),
      ),
    );

    render(<DocViewer doc={markdownDoc} editable />);

    expect(await screen.findByTestId("rich-markdown-editor")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Editable" })).not.toBeInTheDocument();
  });

  it("discards rich edits when cancelled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# Original", { headers: { ETag: '"revision-1"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocViewer doc={markdownDoc} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Changed" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

    expect(await screen.findByRole("heading", { name: "Original" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reflects whether the rich editor has unsaved changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      ),
    );

    render(<DocViewer doc={markdownDoc} editable />);
    await screen.findByLabelText("Document content");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Changed" },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Document content"), {
      target: { value: "# Original" },
    });
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("saves with the document digest and stays in the editor", async () => {
    let finishSave!: (response: Response) => void;
    const saveResponse = new Promise<Response>((resolve) => {
      finishSave = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      )
      .mockReturnValueOnce(saveResponse);
    vi.stubGlobal("fetch", fetchMock);

    render(<DocViewer doc={markdownDoc} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Saved" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save document" }));
    expect(screen.getByRole("button", { name: "Saving document" })).toBeDisabled();

    finishSave(
      new Response(JSON.stringify({ digest: "revision-2" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Save document" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Document content")).toHaveValue("# Saved");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markdown-document")).not.toBeInTheDocument();
    const [, saveInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(saveInit.method).toBe("PUT");
    expect(JSON.parse(String(saveInit.body))).toEqual({
      content: "# Saved",
      digest: "revision-1",
    });
  });

  it("keeps the dirty buffer visible when saving fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: { error: "unavailable" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocViewer doc={markdownDoc} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Still here" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByLabelText("Document content")).toHaveValue("# Still here");
  });

  it("preserves a stale-save draft and overwrites with the conflict digest", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: { error: "conflict", digest: "revision-current" },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ digest: "revision-mine" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocViewer doc={markdownDoc} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This document changed on disk",
    );
    expect(screen.getByLabelText("Document content")).toHaveValue("# Mine");
    expect(screen.getByRole("button", { name: "Reload theirs" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overwrite with mine" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText("Document content")).toHaveValue("# Mine");
    expect(screen.queryByTestId("markdown-document")).not.toBeInTheDocument();
    const [, overwriteInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(String(overwriteInit.body))).toEqual({
      content: "# Mine",
      digest: "revision-current",
    });
  });

  it("reloads the external version after confirming a stale-save conflict", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: { error: "conflict", digest: "revision-current" },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response("# Theirs", { headers: { ETag: '"revision-current"' } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocViewer doc={markdownDoc} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reload theirs" }));

    expect(confirmReload).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: "Reload theirs" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Document content")).toHaveValue("# Theirs"),
    );
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("does not replace a dirty editor when the registry record changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# Original", { headers: { ETag: '"revision-1"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<DocViewer doc={markdownDoc} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Mine" },
    });

    rerender(<DocViewer doc={{ ...markdownDoc }} editable />);

    expect(screen.getByLabelText("Document content")).toHaveValue("# Mine");
    expect(screen.getByRole("status")).toHaveTextContent(
      "This document changed on disk",
    );
    expect(screen.getByRole("button", { name: "Reload external version" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare versions" }))
      .toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enters the external-change flow when the registry's content digest moves", async () => {
    // This is how a live document change reaches an open tab: the watcher
    // settles the rewrite, the registry row's digest moves, and the row the
    // workspace holds is no longer the row it rendered.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# Original", { headers: { ETag: '"revision-1"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const registered = { ...markdownDoc, content_digest: "digest-1" };

    const { rerender } = render(<DocViewer doc={registered} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Mine" },
    });

    // An unchanged rescan hands back the identical row, so nothing happens.
    rerender(<DocViewer doc={registered} editable />);
    expect(screen.queryByText("This document changed on disk")).not.toBeInTheDocument();

    rerender(
      <DocViewer doc={{ ...markdownDoc, content_digest: "digest-2" }} editable />,
    );

    expect(screen.getByLabelText("Document content")).toHaveValue("# Mine");
    expect(screen.getByRole("status")).toHaveTextContent(
      "This document changed on disk",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the intact Markdown source when rich parsing fails", async () => {
    const invalidMarkdown = "# Original\n\n:::custom-directive\nkeep me\n:::";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(invalidMarkdown, { headers: { ETag: '"revision-1"' } }),
      ),
    );

    render(<DocViewer doc={markdownDoc} editable />);
    await screen.findByTestId("rich-markdown-editor");

    fireEvent.click(screen.getByRole("button", { name: "Trigger parse error" }));

    expect(screen.queryByTestId("rich-markdown-editor")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Document source")).toHaveValue(invalidMarkdown);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Editing the original Markdown source instead",
    );
  });

  it("opens a complete HTML .md in source mode without mounting the rich editor", async () => {
    const htmlDocument =
      "<!doctype html><html><head><title>Design</title></head><body><h1>App</h1><script>unsafe()</script></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(htmlDocument, { headers: { ETag: '"revision-1"' } }),
      ),
    );

    render(<DocViewer doc={markdownDoc} editable />);
    await screen.findByRole("heading", { name: "App" });
    expect(document.querySelector("script")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit document source" }));

    expect(screen.queryByTestId("rich-markdown-editor")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Document source")).toHaveValue(htmlDocument);
  });

  it("keeps rich document editing without an agent-chat action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# Editable", { headers: { ETag: '"revision-1"' } }),
      ),
    );

    render(
      <WorkspaceDocument
        doc={markdownDoc}
      />,
    );

    expect(await screen.findByTestId("rich-markdown-editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit with agent" })).not.toBeInTheDocument();
  });

  it("autosaves dirty content every 10 seconds and does nothing while clean", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ digest: "revision-2" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    vi.useFakeTimers();
    render(<DocViewer doc={markdownDoc} editable />);
    await act(async () => {
      await Promise.resolve();
    });
    const editor = screen.getByLabelText("Document content");

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: "# Autosaved" } });
    await act(async () => {
      vi.advanceTimersByTime(9_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Document content")).toHaveValue("# Autosaved");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

    const [, saveInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(saveInit.body))).toEqual({
      content: "# Autosaved",
      digest: "revision-1",
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the full tab width and places Save on the left of editor status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      ),
    );

    render(<DocViewer doc={markdownDoc} editable />);
    const editor = await screen.findByLabelText("Document content");
    expect(editor.parentElement).toHaveClass("w-full");
    expect(editor.parentElement).not.toHaveClass("max-w-4xl");

    fireEvent.change(editor, { target: { value: "# Changed" } });
    const save = screen.getByRole("button", { name: "Save document" });
    const status = screen.getByText("Unsaved changes");
    expect(
      save.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the action row above the independently scrolling editor toolbar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# Original", { headers: { ETag: '"revision-1"' } }),
      ),
    );

    render(<DocViewer doc={markdownDoc} editable />);
    await screen.findByLabelText("Document content");

    const actionRow = screen.getByTestId("document-editor-action-row");
    const scrollRegion = screen.getByTestId("document-editor-scroll-region");
    expect(actionRow).toHaveClass("sticky", "top-0");
    expect(scrollRegion).toHaveClass("min-h-0", "flex-1", "overflow-auto");
    expect(actionRow.parentElement).toBe(scrollRegion.parentElement);
    expect(
      actionRow.compareDocumentPosition(scrollRegion) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps HTML documents in the sandboxed iframe", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DocViewer
        doc={{ ...markdownDoc, rel_path: "interactive.HTML" }}
      />,
    );

    const frame = screen.getByTestId("workspace-doc-frame");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute(
      "src",
      expect.stringContaining("/api/docs/doc-1/interactive.HTML"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
