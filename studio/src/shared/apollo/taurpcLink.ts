import { ApolloLink, Observable } from "@apollo/client";
import { print, type DocumentNode } from "graphql";

import {
  FoundationGraphQlError,
} from "./errorLink";
import type { CreateGraphQlTransportProxy } from "../../runtime/graphQlTransport";

import { moduleLoadPoint } from "../utilities/moduleLoadProbe";

let requestSequence = 0;
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

    const point = moduleLoadPoint(operation.operationName === "WorkTrackerModuleOpen"
      ? operation.variables.moduleId as string : null);
    const requestId = ++requestSequence;
    const probe = (stage: string, details: Record<string, number> = {}) =>
      point(stage, { request_id: requestId, ...details });
    const started = performance.now();
    probe("request-start");
    let active = true;
    void createProxy().graphql_execute(JSON.stringify({
      query: printed(operation.query),
      operationName: operation.operationName,
      variables: operation.variables,
    })).then((encoded) => {
      if (!active) return;
      probe("response-received", { request_ms: performance.now() - started, response_characters: encoded.length });
      const parseStarted = performance.now();
      const result = JSON.parse(encoded);
      probe("response-parsed", { parse_ms: performance.now() - parseStarted });
      const deliveryStarted = performance.now();
      observer.next(result);
      probe("apollo-delivered", { delivery_ms: performance.now() - deliveryStarted });
      observer.complete();
    }).catch((error: unknown) => {
      probe("request-error");
      if (active) observer.error(error);
    });

    return () => {
      active = false;
    };
  }));
}
