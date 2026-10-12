import type { IssueType, State } from "../features/workflows";

/** Test authoring draft only; workItem expands this into a complete generated State. */
export type StateFixtureInput = Pick<State, "id" | "name" | "group"> &
  Partial<Omit<State, "id" | "name" | "group" | "color">> & { color?: string | null };

/** Test authoring draft only; omitted relationships use known empty fixture defaults. */
export type IssueTypeFixtureInput = Pick<IssueType, "id" | "name" | "level"> &
  Partial<Omit<IssueType, "id" | "name" | "level" | "color">> & { color?: string | null };

export function normalizeStateFixture(input: StateFixtureInput, defaults: State): State {
  return { ...defaults, ...input, color: input.color ?? "" };
}

export function normalizeIssueTypeFixture(input: IssueTypeFixtureInput, defaults: IssueType): IssueType {
  return { ...defaults, ...input, color: input.color ?? "" };
}
