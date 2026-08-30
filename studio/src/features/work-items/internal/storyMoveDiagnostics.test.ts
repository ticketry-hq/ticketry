import { describe, expect, it } from "vitest";

import { storyMoveError } from "./storyMoveDiagnostics";

describe("story move diagnostics", () => {
  it("retains GraphQL error codes and paths needed to diagnose a failed move", () => {
    const error = Object.assign(new Error("move failed"), {
      graphQLErrors: [{
        message: "neighbors changed",
        path: ["reorder_work_item"],
        extensions: { code: "conflict" },
      }],
    });

    expect(storyMoveError(error)).toMatchObject({
      name: "Error",
      message: "move failed",
      graphQLErrors: [{
        message: "neighbors changed",
        path: ["reorder_work_item"],
        extensions: { code: "conflict" },
      }],
    });
  });
});

