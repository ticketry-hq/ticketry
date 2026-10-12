import { parseTmuxAgentSessions } from "./campaign-integrity.mjs";
import { createWorkItem, transitionWorkItem, workItemRuns } from "./persisted-facts.mjs";

/**
 * One case's hierarchy: a `Story` root in `Implement` with `childCount`
 * `Implementation` children, each with its own stored sequence, no blockers
 * and a stub control in `hold`. Returns children in stored sequence order and
 * proves nothing runs before the press.
 */
export async function createCampaign(installation, fixture, { label, childCount = 3, stubs }) {
  const { browser } = installation;
  // A Story is born in its type's start state. Where that is not Implement
  // (Pocock's Ideas), the workflow's direct move puts the root in Implement;
  // Implement does not auto-start, so the root gets no agent.
  const root = await createWorkItem(browser, {
    projectId: fixture.project.id,
    name: `${label} campaign root`,
    issueTypeId: fixture.types.story.id,
    parentId: fixture.module.id,
  });
  if (root.state_id !== fixture.states.implement.id) {
    root.state_id = (await transitionWorkItem(browser, root.id, fixture.states.implement.id)).state_id;
  }
  if (root.state_id !== fixture.states.implement.id) throw new Error(`the campaign root ${root.id} is not in Implement`);
  const children = [];
  for (let index = 1; index <= childCount; index += 1) {
    const child = await createWorkItem(browser, {
      projectId: fixture.project.id,
      name: `${label} child ${index}`,
      issueTypeId: fixture.types.implementation.id,
      parentId: root.id,
    });
    if (child.state_id !== fixture.states.implement.id) {
      throw new Error(`campaign child ${child.name} starts in ${child.state_id}, not Implement`);
    }
    stubs.controlWorkItem(child.id, { mode: "hold" });
    children.push(child);
  }
  children.sort((left, right) => left.sequence_id - right.sequence_id);
  if (new Set(children.map((child) => child.sequence_id)).size !== children.length) {
    throw new Error("campaign children do not have distinct stored sequence");
  }

  const rootRuns = await workItemRuns(browser, fixture.project.id, [root.id]);
  if (rootRuns.length > 0) throw new Error(`the campaign root already has agent runs: ${JSON.stringify(rootRuns)}`);
  const sessions = parseTmuxAgentSessions(installation.tmuxInventory());
  if (sessions.length > 0) throw new Error(`private tmux sessions exist before the press: ${JSON.stringify(sessions)}`);
  return { root, children };
}
