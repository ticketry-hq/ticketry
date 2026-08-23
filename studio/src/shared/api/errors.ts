import { FoundationGraphQlError } from "../../graphql-foundation/foundationClient";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof FoundationGraphQlError) return error.message;
  if (error instanceof ApiError) {
    const detail = error.body && typeof error.body === "object"
      ? (error.body as { detail?: unknown }).detail
      : null;
    return typeof detail === "string" && detail ? detail : `${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function isNoOpTransition(error: unknown): boolean {
  if (error instanceof FoundationGraphQlError) {
    return error.code === "illegal_transition"
      && error.extensions.from === error.extensions.to;
  }
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return false;
  const { from, to } = error.body as { from?: unknown; to?: unknown };
  return typeof from === "string" && from === to;
}
