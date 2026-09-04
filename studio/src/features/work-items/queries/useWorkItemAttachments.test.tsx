import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn((_document: unknown, _options?: unknown) => ({
    data: undefined,
  })),
}));

vi.mock("@apollo/client/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@apollo/client/react")>(),
  useQuery: useQueryMock,
}));

import { useWorkItemAttachments } from "./useWorkItemAttachments";

describe("useWorkItemAttachments", () => {
  beforeEach(() => {
    useQueryMock.mockClear();
  });

  it("keeps direct callers immediate by default", () => {
    renderHook(() => useWorkItemAttachments("story-1"));

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variables: { issueId: "story-1" } }),
    );
  });
});
