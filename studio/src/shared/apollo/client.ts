import { ApolloClient, ApolloLink, InMemoryCache } from "@apollo/client";

import type { CreateGraphQlTransportProxy } from "../../runtime/graphQlTransport";
import { studioRuntime } from "../../runtime";
import { createFoundationErrorLink } from "./errorLink";
import { createIssueRevisionGuardLink } from "./issueRevisionGuardLink";
import { createTaurpcLink } from "./taurpcLink";
import { typePolicies } from "./typePolicies";

export function createStudioApolloClient(createProxy: CreateGraphQlTransportProxy) {
  const cache = new InMemoryCache({ typePolicies });
  return new ApolloClient({
    cache,
    link: ApolloLink.from([
      createFoundationErrorLink(),
      createIssueRevisionGuardLink(cache),
      createTaurpcLink(createProxy),
    ]),
    defaultOptions: {
      watchQuery: { fetchPolicy: "cache-first" },
      query: { fetchPolicy: "network-only" },
    },
  });
}

let installed:
  | {
      createProxy: CreateGraphQlTransportProxy;
      client: ReturnType<typeof createStudioApolloClient>;
    }
  | undefined;

/**
 * Return the one Apollo client for the installed runtime.
 *
 * Imperative project/module selection runs before some React consumers mount,
 * so the cache cannot live only inside ApolloProvider. Tests also replace the
 * runtime between cases; comparing the proxy factory replaces server records
 * while carrying the client-only cache rows into the replacement client.
 */
export function studioApolloClient() {
  const createProxy = studioRuntime().graphQlTransport;
  if (!installed || installed.createProxy !== createProxy) {
    const retainedLocalState = installed
      ? Object.fromEntries(
          Object.entries(
            installed.client.cache.extract() as Record<string, unknown>,
          ).filter(
            ([, value]) =>
              value !== null &&
              typeof value === "object" &&
              "__typename" in value &&
              value.__typename === "TicketryLocalState",
          ),
        )
      : {};
    installed = {
      createProxy,
      client: createStudioApolloClient(createProxy),
    };
    const retainedIds = Object.keys(retainedLocalState);
    if (retainedIds.length > 0) {
      installed.client.cache.restore({
        ...retainedLocalState,
        __META: { extraRootIds: retainedIds },
      });
    }
  }
  return installed.client;
}

export async function resetStudioApolloClient(): Promise<void> {
  if (!installed) return;
  await installed.client.clearStore();
  installed = undefined;
}
