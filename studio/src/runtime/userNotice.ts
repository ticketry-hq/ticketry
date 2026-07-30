export const USER_NOTICE_SEVERITIES = ["info", "warning", "error"] as const;

export type UserNoticeSeverity = (typeof USER_NOTICE_SEVERITIES)[number];

export interface UserNotice {
  readonly id: string;
  readonly severity: UserNoticeSeverity;
  readonly title: string;
  readonly message: string;
  readonly acknowledgementLabel: string;
}

const NOTICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function plainText(
  source: Record<string, unknown>,
  field: keyof Pick<UserNotice, "title" | "message" | "acknowledgementLabel">,
): string | null {
  const value = source[field];
  return typeof value === "string" &&
      value.length > 0 &&
      value === value.trim()
    ? value
    : null;
}

/**
 * Validate untrusted runtime input without interpreting any string as markup.
 * Invalid notices are ignored at both startup and event boundaries.
 */
export function validateUserNotice(value: unknown): UserNotice | null {
  const source = record(value);
  if (!source) return null;

  const id = source.id;
  const severity = source.severity;
  const title = plainText(source, "title");
  const message = plainText(source, "message");
  const acknowledgementLabel = plainText(source, "acknowledgementLabel");
  if (
    typeof id !== "string" ||
    !NOTICE_ID.test(id) ||
    !USER_NOTICE_SEVERITIES.includes(severity as UserNoticeSeverity) ||
    !title ||
    !message ||
    !acknowledgementLabel
  ) {
    return null;
  }

  return Object.freeze({
    id,
    severity: severity as UserNoticeSeverity,
    title,
    message,
    acknowledgementLabel,
  });
}

export function validateUserNotices(value: unknown): readonly UserNotice[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const notices: UserNotice[] = [];
  for (const candidate of value) {
    const notice = validateUserNotice(candidate);
    if (!notice || ids.has(notice.id)) continue;
    ids.add(notice.id);
    notices.push(notice);
  }
  return Object.freeze(notices);
}
