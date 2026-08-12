import { agentApiUrl, runtimeConfiguration } from "../../runtime";

/** Fetch a backend host route with the launch-scoped desktop credential. */
export function authenticatedHostFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const key = runtimeConfiguration().values.workTrackerApiKey;
  if (key && !headers.has("x-api-key")) headers.set("x-api-key", key);

  return fetch(agentApiUrl(path), { ...init, headers });
}
