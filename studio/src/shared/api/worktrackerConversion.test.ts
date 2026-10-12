import { gql } from "@apollo/client";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  GeneratedWorkTrackerStateFieldsFragmentDoc, WorkTrackerProjectsDocument,
  WorkTrackerProjectOpenDocument, type WorkTrackerProjectOpenQueryVariables,
  type GeneratedWorkTrackerStateFieldsFragment, type WorkTrackerProjectsQuery,
} from "../../features/projects/generated/projects.documents";
import { publicResult, serverVariables } from "./worktrackerConversion";

const compact = "12345678123412341234123456789abc";
const publicId = "12345678-1234-1234-1234-123456789abc";

describe("publicResult", () => {
  it("converts schema IDs under existing alias styles without changing raw rows", () => {
    const document: TypedDocumentNode<Record<string, string>> = gql`
      query Aliases {
        id project: projectId start_state: startStateId from_state: fromStateId
        issue_type: issueTypeId state: stateId to_issue_id: toIssueId
        from_issue_id: fromIssueId id_looking_alias: name
      }
    `;
    const raw = Object.freeze({
      id: compact, project: compact, start_state: compact, from_state: compact,
      issue_type: compact, state: compact, to_issue_id: compact,
      from_issue_id: compact, id_looking_alias: compact,
    });
    expect(publicResult(document, raw)).toEqual({
      id: publicId, project: publicId, start_state: publicId, from_state: publicId,
      issue_type: publicId, state: publicId, to_issue_id: publicId,
      from_issue_id: publicId, id_looking_alias: compact,
    });
    expect(raw.id).toBe(compact);
  });

  it("resolves nested selections and named and inline fragments without dropping overlaps", () => {
    const document = gql`
      query Nested { nodes { ...Identity ... on WorkItem { child { parent: parentId } } } }
      fragment Identity on WorkItem { child { id } }
    `;
    const child = Object.freeze({ id: compact, parent: compact });
    const raw = Object.freeze({ nodes: Object.freeze([Object.freeze({ child }), null]) });
    expect(publicResult(document, raw)).toEqual({ nodes: [
      { child: { id: publicId, parent: publicId } }, null,
    ] });
    expect(child).toEqual({ id: compact, parent: compact });
  });

  it("converts ID lists and timestamps while preserving null, non-UUIDs and converted values", () => {
    const document = gql`
      query Values { ids: memberId state: stateId id parent: parentId sequenceId
        created: createdAt updated: updatedAt offset: createdAt utc: updatedAt }
    `;
    const raw = {
      ids: [compact, null, "optimistic:row", publicId, "not-a-uuid"],
      state: null, id: "optimistic:new", parent: "not-a-uuid", sequenceId: 42,
      created: "2026-10-11T12:00:00", updated: "2026-10-11T12:00:00+05:30",
      offset: "2026-10-11T12:00:00-04:00", utc: "2026-10-11T12:00:00Z",
    };
    const converted = publicResult(document, raw);
    expect(converted).toEqual({ ...raw,
      ids: [publicId, null, "optimistic:row", publicId, "not-a-uuid"],
      created: "2026-10-11T12:00:00Z",
    });
    expect(publicResult(document, converted)).toEqual(converted);
    expect(publicResult(document, null)).toBeNull();
  });

  it("supports generated fragment roots and preserves their generated type", () => {
    const raw: GeneratedWorkTrackerStateFieldsFragment = {
      id: compact, project: compact, name: "Todo", group: "unstarted", color: "blue",
      sort_order: 0, is_protected: false, created_at: "2026-10-11T12:00:00",
      updated_at: "2026-10-11T12:00:00Z",
    };
    const result = publicResult(GeneratedWorkTrackerStateFieldsFragmentDoc, raw);
    expectTypeOf(result).toEqualTypeOf<GeneratedWorkTrackerStateFieldsFragment>();
    expect(result).toEqual({ ...raw, id: publicId, project: publicId, created_at: "2026-10-11T12:00:00Z" });
  });

  it("memoizes by document and query result while retaining generated result types", () => {
    const raw: WorkTrackerProjectsQuery = { projects: { nodes: [{
      id: compact, name: "Ticketry", slug: "CODING", description: "",
      created_at: "2026-10-11T12:00:00",
    }] } };
    const result = publicResult(WorkTrackerProjectsDocument, raw);
    expectTypeOf(result).toEqualTypeOf<WorkTrackerProjectsQuery>();
    expect(result.projects.nodes[0].id).toBe(publicId);
    expect(publicResult(WorkTrackerProjectsDocument, raw)).toBe(result);
    const otherDocument = gql`query Names { projects { nodes { name } } }`;
    expect(publicResult(otherDocument, raw).projects.nodes[0].id).toBe(compact);
    expect(publicResult(WorkTrackerProjectsDocument, { ...raw })).not.toBe(result);
  });

  it("resolves conflicting aliases by runtime type and retains abstract fragment fields", () => {
    const document = gql`
      query Types { nodes { __typename ...NodeFields ... on WorkItem { value: id }
        ... on Label { value: name } } }
      fragment NodeFields on Node { parent: parentId }
    `;
    expect(publicResult(document, { nodes: [
      { __typename: "Label", value: compact, parent: compact },
      { __typename: "WorkItem", value: compact, parent: compact },
    ] })).toEqual({ nodes: [
      { __typename: "Label", value: compact, parent: publicId },
      { __typename: "WorkItem", value: publicId, parent: publicId },
    ] });
  });

  it("retains parent type conditions through overlapping nested selections", () => {
    const document = gql`
      query NestedTypes { nodes { __typename ... on WorkItem { child { value: id } }
        ... on Label { child { value: name } } ... on Node { child { parent: parentId } } } }
    `;
    expect(publicResult(document, { nodes: [
      { __typename: "Label", child: { value: compact, parent: compact } },
      { __typename: "WorkItem", child: { value: compact, parent: compact } },
    ] })).toEqual({ nodes: [
      { __typename: "Label", child: { value: compact, parent: publicId } },
      { __typename: "WorkItem", child: { value: publicId, parent: publicId } },
    ] });
  });
});

describe("serverVariables", () => {
  it("preserves generated operation variable types and compacts *Id strings", () => {
    const variables: WorkTrackerProjectOpenQueryVariables = { projectId: publicId };
    const result = serverVariables(WorkTrackerProjectOpenDocument, variables);
    expectTypeOf(result).toEqualTypeOf<WorkTrackerProjectOpenQueryVariables>();
    expect(result).toEqual({ projectId: compact });
  });
  it("compacts only document-defined id, *Id and *Ids variables with the same type", () => {
    type Variables = { id: string; projectId: string | null; itemIds: (string | null)[];
      name: string; idOrKey: string; externalId: string; };
    const document: TypedDocumentNode<unknown, Variables> = gql`
      mutation Write($id: String!, $projectId: String, $itemIds: [String], $name: String!, $idOrKey: String!) {
        update(id: $id, projectId: $projectId, itemIds: $itemIds, name: $name, key: $idOrKey) { id }
      }
    `;
    const raw: Variables = Object.freeze({ id: publicId, projectId: null,
      itemIds: [publicId, compact, null, "optimistic:new", "not-a-uuid"],
      name: publicId, idOrKey: publicId, externalId: publicId,
    });
    const result = serverVariables(document, raw);
    expectTypeOf(result).toEqualTypeOf<Variables>();
    expect(result).toEqual({ ...raw, id: compact,
      itemIds: [compact, compact, null, "optimistic:new", "not-a-uuid"],
    });
    expect(serverVariables(document, result)).toEqual(result);
    expect(raw.id).toBe(publicId);
  });
});
