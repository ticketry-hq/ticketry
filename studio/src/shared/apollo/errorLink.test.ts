import { ApolloClient, ApolloLink, gql, InMemoryCache, Observable } from "@apollo/client";
import { describe, expect, it } from "vitest";

import { createFoundationErrorLink, FoundationGraphQlError } from "./errorLink";

describe("Apollo foundation error link", () => {
  it("keeps the existing FoundationGraphQlError contract", async () => {
    const response = new ApolloLink(() => new Observable((observer) => {
      observer.next({
        data: null,
        errors: [{
          message: "The Work Item revision is stale.",
          extensions: { code: "stale_revision", currentRevision: 7 },
        }],
      });
      observer.complete();
    }));
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.from([createFoundationErrorLink(), response]),
    });

    const error = await client.query({
      query: gql`query ErrorProbe { migrationProbes { nodes { id } } }`,
      fetchPolicy: "no-cache",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FoundationGraphQlError);
    expect(error).toMatchObject({
      code: "stale_revision",
      extensions: { currentRevision: 7 },
    });
  });
});
