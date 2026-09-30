import { describe, expect, it } from "vitest";

import { ApiError } from "../../../../shared/api/errors";
import { isViewerLeaseLost, viewerLeaseFailureCode } from "./viewerLeaseFailure";

describe("viewer lease failure codes", () => {
  it("reads the code from a plain Tauri command rejection", () => {
    expect(viewerLeaseFailureCode({ code: "viewer_lease_not_owned" }))
      .toBe("viewer_lease_not_owned");
  });

  it("reads the code an ApiError carries in its body", () => {
    const error = new ApiError(409, "conflict", {
      detail: "conflict",
      code: "viewer_lease_not_owned",
    });
    expect(viewerLeaseFailureCode(error)).toBe("viewer_lease_not_owned");
    expect(isViewerLeaseLost(error)).toBe(true);
  });

  it("treats replacement by another viewer as lease loss", () => {
    expect(isViewerLeaseLost(new ApiError(409, "conflict", {
      code: "replaced_by_another_viewer",
    }))).toBe(true);
  });

  it("does not treat unrelated failures as lease loss", () => {
    expect(isViewerLeaseLost(new ApiError(503, "down", { code: "storage_unavailable" })))
      .toBe(false);
    expect(isViewerLeaseLost(new Error("network"))).toBe(false);
    expect(viewerLeaseFailureCode("viewer_lease_not_owned")).toBeNull();
    expect(viewerLeaseFailureCode(null)).toBeNull();
  });
});
