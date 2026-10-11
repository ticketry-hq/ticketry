import { ApolloClient, ApolloLink, gql, InMemoryCache, Observable } from "@apollo/client";
import { describe, expect, it } from "vitest";
import { normalizedEntityPolicies } from "./cacheKeys";
import { writeCommittedConversationTitle } from "./committedConversationTitle";
import { createConversationTitleGuardLink } from "./conversationTitleGuardLink";

const ticketsQuery = gql`
  query InstantRunTickets {
    tickets: instant_run_tickets(project_id: "project-1", module_id: "module-1") {
      agent_run_id
      title
      user_title
      started_at
    }
  }
`;
const titleFragment = gql`
  fragment GuardedConversationTitle on InstantRunTicket {
    title
    user_title
  }
`;

function ticket(title = "Original title", userTitle: string | null = null, runId = "run-1") {
  return {
    __typename: "InstantRunTicket" as const,
    agent_run_id: runId,
    title,
    user_title: userTitle,
    started_at: "2026-10-07T10:00:00Z",
  };
}

type Ticket = ReturnType<typeof ticket>;
type QueryData = { tickets: Ticket[] };

function fixture(initial: Ticket[] = [ticket()]) {
  const cache = new InMemoryCache({ typePolicies: normalizedEntityPolicies() });
  if (initial.length) cache.writeQuery({ query: ticketsQuery, data: { tickets: initial } });
  let reply: (data: Record<string, unknown> | undefined) => void = () => { throw new Error("No request"); };
  let started: () => void = () => {};
  const client = new ApolloClient({
    cache,
    link: ApolloLink.from([
      createConversationTitleGuardLink(cache),
      new ApolloLink(() => new Observable((observer) => {
        reply = (data) => { observer.next({ data }); observer.complete(); };
        started();
      })),
    ]),
  });
  return {
    cache,
    writeTitle(name: string, runId = "run-1") {
      writeCommittedConversationTitle(cache, runId, name);
    },
    async request(fetchPolicy: "network-only" | "no-cache" = "network-only") {
      const ready = new Promise<void>((resolve) => { started = resolve; });
      const result = client.query<QueryData>({ query: ticketsQuery, fetchPolicy });
      await ready;
      return { result, reply: (data: Record<string, unknown> | undefined) => reply(data) };
    },
  };
}

describe("conversation title request guard", () => {
  it("preserves a successful rename committed while a stale list request is pending", async () => {
    const state = fixture([ticket(), ticket("Other conversation", null, "run-2")]);
    const request = await state.request();
    state.writeTitle("Saved title");
    const stale = { tickets: [ticket(), ticket("Remote other title", "Remote other title", "run-2")] };
    request.reply(stale);
    const { data } = await request.result;
    expect(data?.tickets[0]).toMatchObject({ title: "Saved title", user_title: "Saved title" });
    expect(data?.tickets[1]).toMatchObject({ title: "Remote other title", user_title: "Remote other title" });
    expect(stale.tickets[0]).toMatchObject({ title: "Original title", user_title: null });
    expect(state.cache.readQuery<QueryData>({ query: ticketsQuery })?.tickets[0].title).toBe("Saved title");
  });

  it("accepts a later remote rename when the cached user title did not change during its request", async () => {
    const state = fixture([ticket("Local title", "Local title")]);
    const request = await state.request();
    request.reply({ tickets: [ticket("Other window title", "Other window title")] });
    expect((await request.result).data?.tickets[0].title).toBe("Other window title");
  });

  it("keeps the latest of repeated successful renames during one request", async () => {
    const state = fixture([ticket("First title", "First title")]);
    const request = await state.request();
    state.writeTitle("Second title");
    state.writeTitle("Third title");
    request.reply({ tickets: [ticket("First title", "First title")] });
    expect((await request.result).data?.tickets[0].title).toBe("Third title");
  });

  it("preserves a successful rename back to the original title across a delayed list response", async () => {
    const state = fixture([ticket("Original title", "Original title")]);
    const request = await state.request();
    state.writeTitle("Intermediate title");
    const delayed = { tickets: [ticket("Intermediate title", "Intermediate title")] };
    state.writeTitle("Original title");
    request.reply(delayed);
    expect((await request.result).data?.tickets[0]).toMatchObject({
      title: "Original title",
      user_title: "Original title",
    });
    expect(state.cache.readQuery<QueryData>({ query: ticketsQuery })?.tickets[0]).toMatchObject({
      title: "Original title",
      user_title: "Original title",
    });

    const later = await state.request();
    later.reply({ tickets: [ticket("Later remote title", "Later remote title")] });
    expect((await later.result).data?.tickets[0]).toMatchObject({
      title: "Later remote title",
      user_title: "Later remote title",
    });
    expect(state.cache.readQuery<QueryData>({ query: ticketsQuery })?.tickets[0]).toMatchObject({
      title: "Later remote title",
      user_title: "Later remote title",
    });
  });

  it("accepts server removal from the list when an omitted conversation is renamed during its request", async () => {
    const state = fixture([ticket(), ticket("Other conversation", null, "run-2")]);
    const request = await state.request();
    state.writeTitle("Saved title");
    request.reply({ tickets: [ticket("Other conversation", null, "run-2")] });
    expect((await request.result).data?.tickets.map((row) => row.agent_run_id)).toEqual(["run-2"]);
    expect(state.cache.readQuery<QueryData>({ query: ticketsQuery })?.tickets.map((row) => row.agent_run_id)).toEqual(["run-2"]);
  });

  it("guards a title saved when the ticket had no cache row at request start", async () => {
    const state = fixture([]);
    const request = await state.request();
    state.writeTitle("Saved before first list");
    request.reply({ tickets: [ticket()] });
    expect((await request.result).data?.tickets[0].title).toBe("Saved before first list");
  });

  it("accepts the server response after a failed rename that did not update the cache", async () => {
    const state = fixture();
    const request = await state.request();
    request.reply({ tickets: [ticket("Authoritative title")] });
    expect((await request.result).data?.tickets[0].title).toBe("Authoritative title");
  });

  it("does not guard an automatic title change without a saved user title", async () => {
    const state = fixture();
    const request = await state.request();
    state.cache.writeFragment({
      id: state.cache.identify({ __typename: "InstantRunTicket", agent_run_id: "run-1" }),
      fragment: titleFragment,
      data: { title: "Automatic cache update", user_title: null },
    });
    request.reply({ tickets: [ticket("Authoritative title")] });
    expect((await request.result).data?.tickets[0].title).toBe("Authoritative title");
  });

  it("ignores optimistic title drafts when comparing request and response", async () => {
    const state = fixture();
    const request = await state.request();
    state.cache.recordOptimisticTransaction((cache) => {
      cache.writeFragment({
        id: cache.identify({ __typename: "InstantRunTicket", agent_run_id: "run-1" }),
        fragment: titleFragment,
        data: { title: "Unsaved draft", user_title: "Unsaved draft" },
      });
    }, "unsaved-title");
    request.reply({ tickets: [ticket("Server title")] });
    await request.result;
    state.cache.removeOptimistic("unsaved-title");
    expect(state.cache.readQuery<QueryData>({ query: ticketsQuery })?.tickets[0].title).toBe("Server title");
  });

  it("leaves absent and empty response projections intact", async () => {
    const state = fixture([]);
    const empty = await state.request();
    state.writeTitle("Saved title");
    empty.reply({ tickets: [] });
    expect((await empty.result).data?.tickets).toEqual([]);
    const missing = await state.request("no-cache");
    missing.reply(undefined);
    expect((await missing.result).data).toBeUndefined();
  });
});
