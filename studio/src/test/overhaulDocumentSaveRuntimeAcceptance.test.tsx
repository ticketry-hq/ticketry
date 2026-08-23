import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DocViewer from "../app/shell/ticket-workspace/selected-ticket/documents/DocViewer";
import type { DesignDoc } from "../features/documents";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";

vi.mock("../state/clientStore", () => ({
  dialog: { confirm: vi.fn().mockResolvedValue(true) },
}));

vi.mock("../app/shell/ticket-workspace/selected-ticket/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label="Document content"
      defaultValue={markdown}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const doc: DesignDoc = { id: "doc-spec", rel_path: "SPEC.md", label: "SPEC" };

interface SaveRequest {
  readonly expectedDigest: string;
  readonly content: string;
  readonly operationId: string;
}

/// A desktop runtime whose save answers are scripted, recording exactly what
/// each attempt asked for.
async function desktopStudio(
  outcomes: ReadonlyArray<{ digest: string; saved: boolean; stale: boolean }>,
): Promise<{ saves: SaveRequest[] }> {
  const saves: SaveRequest[] = [];
  const graphql_execute = vi.fn(async (encoded: string) => {
    const request = JSON.parse(encoded) as {
      operationName: string;
      variables: SaveRequest & { documentId: string };
    };
    expect(request.operationName).toBe("SaveDesignDocument");
    saves.push({
      expectedDigest: request.variables.expectedDigest,
      content: request.variables.content,
      operationId: request.variables.operationId,
    });
    const outcome = outcomes[Math.min(saves.length - 1, outcomes.length - 1)];
    return JSON.stringify({
      data: {
        save_design_document: { document_id: doc.id, ...outcome },
      },
    });
  });
  initializeStudioRuntime(await createDesktopRuntime({
    invoke: vi.fn().mockResolvedValue(startup),
    createGraphQlProxy: () => ({
      graphql_execute,
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  }));
  return { saves };
}

describe("document save desktop runtime acceptance", () => {
  afterEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("[overhaul-87] saves through the runtime and preserves the draft through a stale conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# original", { headers: { ETag: '"digest-original"' } }),
      ),
    );
    const { saves } = await desktopStudio([
      { digest: "digest-theirs", saved: false, stale: true },
      { digest: "digest-mine", saved: true, stale: false },
    ]);

    render(<DocViewer doc={doc} editable />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    // A stale save is not a failure: the draft is untouched and the editor
    // offers the deliberate retry against the version on disk.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This document changed on disk",
    );
    expect(screen.getByLabelText("Document content")).toHaveValue("# mine");
    expect(saves[0]).toMatchObject({
      expectedDigest: "digest-original",
      content: "# mine",
    });

    fireEvent.click(screen.getByRole("button", { name: "Overwrite with mine" }));

    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]).toMatchObject({
      expectedDigest: "digest-theirs",
      content: "# mine",
    });
    // Each intent carries its own identity, so a replayed request can be told
    // apart from a deliberate second edit.
    expect(saves[0].operationId).not.toEqual(saves[1].operationId);
    expect(saves[1].operationId).toBeTruthy();
    expect(screen.getByLabelText("Document content")).toHaveValue("# mine");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
