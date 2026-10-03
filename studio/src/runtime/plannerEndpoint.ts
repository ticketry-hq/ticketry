/** The live listener discovered through Ticketry's local desktop configuration. */
export interface PlannerEndpoint {
  readonly graphqlUrl: string;
  readonly bearerToken: string;
}

export function parsePlannerEndpoint(value: unknown): PlannerEndpoint | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || !("graphqlUrl" in value) || !("bearerToken" in value)) {
    throw new Error("Invalid Studio runtime configuration: plannerEndpoint must contain a URL and instance credential");
  }
  const { graphqlUrl, bearerToken } = value;
  if (typeof graphqlUrl !== "string" || typeof bearerToken !== "string" || !/^[a-f0-9]{32}$/.test(bearerToken)) {
    throw new Error("Invalid Studio runtime configuration: plannerEndpoint has an invalid URL or instance credential");
  }
  let url: URL;
  try {
    url = new URL(graphqlUrl);
  } catch {
    throw new Error("Invalid Studio runtime configuration: plannerEndpoint.graphqlUrl must be a loopback GraphQL URL");
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || Number(url.port || "80") < 1
      || url.pathname !== "/graphql" || url.search || url.hash || url.username || url.password) {
    throw new Error("Invalid Studio runtime configuration: plannerEndpoint.graphqlUrl must be a loopback GraphQL URL");
  }
  return Object.freeze({ graphqlUrl, bearerToken });
}
