export interface WorkTrackerValidationDetail {
  type: string;
  loc: Array<string | number>;
  msg: string;
  ctx?: Record<string, unknown> | null;
}

export class WorkTrackerApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
  readonly validationDetails?: WorkTrackerValidationDetail[];

  constructor(
    status: number,
    message: string,
    body: unknown,
    headers: Headers = new Headers(),
  ) {
    super(message);
    this.name = "WorkTrackerApiError";
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.validationDetails = validationDetails(body);
  }

  static async fromResponse(response: Response): Promise<WorkTrackerApiError> {
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return new WorkTrackerApiError(
      response.status,
      errorMessage(response.status, body),
      body,
      response.headers,
    );
  }
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first === "object" && "msg" in first) {
        return String((first as { msg?: unknown }).msg);
      }
    }
  }
  return `HTTP ${status}`;
}

function validationDetails(
  body: unknown,
): WorkTrackerValidationDetail[] | undefined {
  if (!body || typeof body !== "object" || !("detail" in body)) return undefined;
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return undefined;
  return detail as WorkTrackerValidationDetail[];
}
