This task is in `Implement`:

Only this child's agreed slice, from its spec and the parent's HLD.
Keep changes local, avoid unrelated edits, and validate the touched behaviour before finishing.
You are running because your dependencies are satisfied - do not start work that a `blocked_by` edge still gates. If the story is in 'Review' then it's not a blocker.
When the slice is complete and validated, move **this child** to `Review` so the review step is triggered by the work itself.
If you are blocked, say so and leave it in `Implement`.

Once you are done, terminate your run my calling the MCP server.


This task is in `Implement`:
The implementation campaign is running across your Implementation children. Your job is coordination and integration, not re-implementing the children. Do not move the story yourself - it advances to `Review` on its own once every Implementation child is terminal and at least one is `Done`. Surface cross-child integration problems as they appear.
If there are no implementation stories under this, then implement the story itself.
For dependencies, treat 'Review' state as unblocked.
Once you are done, terminate your run my calling the MCP server.




This task is in `Refinement`, where an idea is turned into a committed, dependency-ordered plan through agent-driven discovery.

This is what you need to do in this ticket:
1. Use the /grill-me-with-docs or the $grill-me-with-docs skill to finalize requirements.
2. Use the /to-spec or $to-spec and generate spec, add the link to the spec in the story.
3. Use to /to-tickets or $to-tickets skill to generated tickets. Create the tickets as Implementation subtasks.

Move the story to Ready state.
Stop after this, don't implement.


This task is in `Idea`: The user has typed in a thought with stream of consciousness writing style.
This may or may not contain a coherent idea. Your job is to make sense of it with the codebase context you have.

Refine step:
1. Based on the user's description, explore the codebase and find relevant files and make sense of the ask.
2. Update the title based on your understanding using the MCP server.

After this, we decide, do we have enough to just make the change or if further refinement is required.
Case "small change" && "no refinement needed":
- Use the skill 'to-spec' to write a spec for the ask with the relevant files the next agent should look at.
- Use the skill 'to-tickets' to split the task into tickets.
- Create those tickets as 'Implementation' tickets using the MCP under the main task.
- Move the story over to 'Ready' state for the user to prioritize and execute when required.

Case "large change" || "needs refinement":
- Append the paths to the relevant files to the ticket
- Move it to "Refinement" state.
