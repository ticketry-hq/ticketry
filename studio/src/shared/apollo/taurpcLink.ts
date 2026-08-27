import { ApolloLink, Observable } from "@apollo/client";
import { print, type DocumentNode } from "graphql";

import {
  FoundationGraphQlError,
} from "./errorLink";
import type { CreateGraphQlTransportProxy } from "../../runtime/graphQlTransport";

const printedDocuments = new WeakMap<DocumentNode, string>();

function printed(document: DocumentNode): string {
  const cached = printedDocuments.get(document);
  if (cached !== undefined) return cached;
  const source = print(document);
  printedDocuments.set(document, source);
  return source;
}

export function createTaurpcLink(createProxy: CreateGraphQlTransportProxy): ApolloLink {
  return new ApolloLink((operation) => new Observable((observer) => {
    if (!operation.operationName) {
      observer.error(new FoundationGraphQlError(
        "validation",
        "The GraphQL document must contain one named operation.",
      ));
      return;
    }

    let active = true;
    void createProxy().graphql_execute(JSON.stringify({
      query: printed(operation.query),
      operationName: operation.operationName,
      variables: operation.variables,
    })).then((encoded) => {
      if (!active) return;
      observer.next(JSON.parse(encoded));
      observer.complete();
    }).catch((error: unknown) => {
      if (active) observer.error(error);
    });

    return () => {
      active = false;
    };
  }));
}
