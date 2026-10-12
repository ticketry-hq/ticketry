import { initializeStudioRuntime, studioRuntime } from "../runtime";
import type { StudioRuntime } from "../runtime";
import {
  executeGraphQlTransport,
  type CreateGraphQlTransportProxy,
} from "../runtime/graphQlTransport";
import type { FoundationDomainErrorCode } from "../shared/apollo/errorLink";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

/**
 * A scripted GraphQL transport under the real Studio Apollo client.
 *
 * The installed runtime keeps every Studio link (error mapping, issue revision
 * guard, transport) and replaces only `graphql_execute`. Every request is
 * recorded with its operation name and variables, in send order. A test
 * scripts each operation to answer, fail with a domain error code, or hold
 * its response until the test releases it, which is how it simulates slow,
 * concurrent and stale requests. Unscripted operations fail loudly.
 */
export interface ScriptedGraphQlRequest {
  readonly operationName: string;
  readonly variables: Readonly<Record<string, unknown>>;
}

/**
 * An answer is the operation's data, or a function of its variables that
 * returns (or resolves to) that data. A function that throws a
 * `ScriptedGraphQlFailure` fails the request with that domain error instead.
 */
export type ScriptedAnswer =
  | unknown
  | ((variables: Readonly<Record<string, unknown>>) => unknown);

export class ScriptedGraphQlFailure extends Error {
  constructor(
    readonly code: FoundationDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScriptedGraphQlFailure";
  }
}

export interface HeldGraphQlResponse {
  /** Resolves with the held request once Studio has sent it. */
  readonly reached: Promise<ScriptedGraphQlRequest>;
  answer(data: unknown): void;
  fail(code: FoundationDomainErrorCode, message?: string): void;
}

export interface ScriptedGraphQlTransport {
  /** Every request in send order; stays live for the rest of the test. */
  readonly requests: readonly ScriptedGraphQlRequest[];
  operationNames(): string[];
  /** Answer every request for this operation, unless a one-shot script is queued. */
  answer(operationName: string, data: ScriptedAnswer): ScriptedGraphQlTransport;
  /** Answer only the next request for this operation. */
  answerNext(operationName: string, data: ScriptedAnswer): ScriptedGraphQlTransport;
  /** Fail the next request for this operation with a GraphQL domain error. */
  failNext(
    operationName: string,
    code: FoundationDomainErrorCode,
    message?: string,
  ): ScriptedGraphQlTransport;
  /** Hold the next request for this operation until the test releases it. */
  holdNext(operationName: string): HeldGraphQlResponse;
}

type Reply = (request: ScriptedGraphQlRequest) => Promise<string>;

function failed(code: FoundationDomainErrorCode, message: string): string {
  return JSON.stringify({ data: null, errors: [{ message, extensions: { code } }] });
}

async function answered(
  data: ScriptedAnswer,
  variables: ScriptedGraphQlRequest["variables"],
): Promise<string> {
  try {
    return JSON.stringify({
      data: typeof data === "function"
        ? await (data as (input: typeof variables) => unknown)(variables)
        : data,
    });
  } catch (error) {
    if (error instanceof ScriptedGraphQlFailure) return failed(error.code, error.message);
    throw error;
  }
}

export function installScriptedGraphQlTransport(): ScriptedGraphQlTransport {
  const requests: ScriptedGraphQlRequest[] = [];
  const persistent = new Map<string, Reply>();
  const queued = new Map<string, Reply[]>();
  const enqueue = (operationName: string, reply: Reply) => {
    queued.set(operationName, [...(queued.get(operationName) ?? []), reply]);
  };

  const createProxy: CreateGraphQlTransportProxy = () => ({
    graphql_execute: async (requestJson: string) => {
      const parsed = JSON.parse(requestJson) as {
        operationName: string;
        variables?: Record<string, unknown>;
      };
      const request = {
        operationName: parsed.operationName,
        variables: parsed.variables ?? {},
      };
      requests.push(request);
      const next = queued.get(request.operationName)?.shift();
      const reply = next ?? persistent.get(request.operationName);
      if (!reply) {
        return failed("unknown", `Unscripted GraphQL operation ${request.operationName}`);
      }
      return reply(request);
    },
    graphql_subscribe: async () => '{"type":"accepted"}',
    graphql_unsubscribe: async () => true,
  });

  installDesktopGraphQlRuntime();
  const route: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.graphQl((document, variables) =>
      executeGraphQlTransport(document, variables, createProxy));
  initializeStudioRuntime({
    ...studioRuntime(),
    graphQlTransport: createProxy,
    readWorkTracker: route,
    writeWorkTracker: route,
  });

  const transport: ScriptedGraphQlTransport = {
    requests,
    operationNames: () => requests.map((request) => request.operationName),
    answer(operationName, data) {
      persistent.set(operationName, async ({ variables }) => answered(data, variables));
      return transport;
    },
    answerNext(operationName, data) {
      enqueue(operationName, async ({ variables }) => answered(data, variables));
      return transport;
    },
    failNext(operationName, code, message = `${operationName} failed`) {
      enqueue(operationName, async () => failed(code, message));
      return transport;
    },
    holdNext(operationName) {
      let reach!: (request: ScriptedGraphQlRequest) => void;
      let release!: (encoded: string) => void;
      const reached = new Promise<ScriptedGraphQlRequest>((resolve) => {
        reach = resolve;
      });
      const response = new Promise<string>((resolve) => {
        release = resolve;
      });
      enqueue(operationName, (request) => {
        reach(request);
        return response;
      });
      return {
        reached,
        answer: (data) => release(JSON.stringify({ data })),
        fail: (code, message = `${operationName} failed`) => release(failed(code, message)),
      };
    },
  };
  return transport;
}
