import { studioRuntime } from "../../../runtime";
import { FoundationGraphQlError } from "../../../graphql-foundation/foundationClient";
import {
  RunWorkTrackerWorkItemNowDocument,
  type RunNowPayload,
} from "./runNowOperation";

export interface RunNowResponse {
  target_id: string;
  committed_state: { id: string; name: string };
  run: { target_id: string; agent: string; agent_run_id: string };
}

export interface RunNowRefusal {
  target_id: string;
  committed_state: { id: string; name: string } | null;
  run: null;
  detail: string;
  code: string;
  remedy?: string | null;
}

export class RunNowRefusalError extends Error {
  readonly body: RunNowRefusal;

  constructor(body: RunNowRefusal) {
    super(body.detail);
    this.name = "RunNowRefusalError";
    this.body = body;
  }
}

function refusal(payload: RunNowPayload): RunNowRefusalError {
  const body: RunNowRefusal = {
    target_id: payload.target_id,
    committed_state: payload.committed_state,
    run: null,
    detail: payload.detail,
    code: payload.code,
    remedy: payload.remedy,
  };
  return new RunNowRefusalError(body);
}

export function runWorkItemNow(issueId: string): Promise<RunNowResponse> {
  const requestIdentity = crypto.randomUUID();
  return studioRuntime().writeWorkTracker({
    rest: () => Promise.reject(
      new Error("Run Now is available only through desktop Studio."),
    ),
    graphQl: async (execute) => {
      const variables = {
        idOrKey: issueId,
        requestIdentity,
      };
      let response;
      try {
        response = await execute(RunWorkTrackerWorkItemNowDocument, variables);
      } catch (error) {
        if (error instanceof FoundationGraphQlError) throw error;
        response = await execute(RunWorkTrackerWorkItemNowDocument, variables);
      }
      const payload = response.run_now;
      if (!payload.run || !payload.committed_state) throw refusal(payload);
      return {
        target_id: payload.target_id,
        committed_state: payload.committed_state,
        run: payload.run,
      };
    },
  });
}
