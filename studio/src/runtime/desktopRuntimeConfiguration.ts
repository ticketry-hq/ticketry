import type { RuntimeStartupConfiguration, ServiceHealth } from "./contract";
import { parsePlannerEndpoint } from "./plannerEndpoint";
import { validateUserNotices } from "./userNotice";

type HealthDecodeResult =
  | { readonly ok: true; readonly health: ServiceHealth }
  | { readonly ok: false; readonly field: string; readonly expectation: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function decodeServiceHealth(value: unknown): HealthDecodeResult {
  const health = record(value);
  if (!health) {
    return { ok: false, field: "configuration", expectation: "must include serviceHealth" };
  }
  const { state, service, message, logPointer } = health;
  if (state !== "starting" && state !== "migrating" && state !== "ready" &&
      state !== "recovering" && state !== "degraded" && state !== "failed") {
    return { ok: false, field: "serviceHealth.state", expectation: "must be a stable service-health state" };
  }
  if (service !== null && typeof service !== "string") {
    return { ok: false, field: "serviceHealth.service", expectation: "must be a string or null" };
  }
  if (message !== null && typeof message !== "string") {
    return { ok: false, field: "serviceHealth.message", expectation: "must be a string or null" };
  }
  if (logPointer !== null && typeof logPointer !== "string") {
    return { ok: false, field: "serviceHealth.logPointer", expectation: "must be a string or null" };
  }
  return { ok: true, health: Object.freeze({ state, service, message, logPointer }) };
}

export function parseDesktopServiceHealth(value: unknown): ServiceHealth | null {
  const result = decodeServiceHealth(value);
  return result.ok ? result.health : null;
}

export function parseDesktopConfigurationHealth(value: unknown): ServiceHealth | null {
  return parseDesktopServiceHealth(record(value)?.serviceHealth);
}

/** Startup failures are actionable; malformed event payloads are ignored. */
export function validateDesktopConfiguration(value: unknown): RuntimeStartupConfiguration {
  const configuration = record(value);
  if (!configuration || !record(configuration.serviceHealth)) {
    throw new Error("Desktop initialization failed: configuration must include serviceHealth");
  }
  const runtimeInstance = configuration.runtimeInstance;
  if (runtimeInstance !== undefined &&
      (typeof runtimeInstance !== "string" || runtimeInstance.length === 0)) {
    throw new Error("Desktop initialization failed: configuration.runtimeInstance must be a non-empty string when present");
  }
  const decoded = decodeServiceHealth(configuration.serviceHealth);
  if (!decoded.ok) {
    throw new Error(`Desktop initialization failed: ${decoded.field} ${decoded.expectation}`);
  }
  return Object.freeze({
    runtimeInstance,
    ...(configuration.plannerEndpoint === undefined ? {} : {
      plannerEndpoint: parsePlannerEndpoint(configuration.plannerEndpoint),
    }),
    serviceHealth: decoded.health,
    initialNotices: validateUserNotices(configuration.initialNotices),
  });
}
