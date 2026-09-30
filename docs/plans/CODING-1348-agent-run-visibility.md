# Agent-run visibility after launch

Story: CODING-1348

## Problem statement

A person can launch an agent successfully but wait several seconds before the new run appears in the Studio workspace. During that gap, Studio gives too little evidence that the launch worked. The person may click again and create unintended runs.

The backend commit is not the slow part. Captured launch transactions completed in 2 to 3 ms, while one run did not appear for roughly 9 seconds. That trace crossed a development runtime restart, so it cannot establish the cause under a healthy, already connected status subscription. A later connected trace delivered lifecycle facts about 890 to 1,100 ms after commit, close to the status stream's 1,000 ms safety reread. The remaining question is whether the post-commit wake-up is ineffective, whether subscription lifecycle churn delays the frontend, or whether the frontend's unknown-run resync adds the delay.

## Solution

Trace one launch across the existing durable status path while a single project subscription is connected and caught up. Correlate the launch commit, wake-up, durable event read, GraphQL frame, Apollo cache write, and workspace render. Use that trace to fix the first proven delay, then make every affected launch entry point show one acknowledged run without another click.

The healthy path must be event-driven. A launched run should reach the visible workspace within 500 ms of commit in the local acceptance environment. The 1,000 ms durable reread remains recovery for a lost wake-up, not the normal discovery path. Restart recovery may take a fresh handshake, but once the subscription is accepted its snapshot must expose the committed run without an extra reconnect.

## User stories

1. As a person launching an agent, I want the new run to appear promptly, so that I know the launch succeeded.
2. As a person launching an agent, I want one click to create one visible run, so that missing feedback does not encourage duplicate launches.
3. As a person using Run now, I want the acknowledged run and its terminal to refer to the same durable Agent Run, so that Studio does not show conflicting launch state.
4. As a person using another task launch action, I want the same prompt feedback as Run now, so that launch behavior does not depend on the entry point.
5. As a person returning after a runtime restart, I want committed runs to appear in the first authoritative snapshot, so that a restart does not hide work that already began.
6. As a developer investigating launch latency, I want one correlated timeline from commit to render, so that I can distinguish backend, transport, cache, and UI delay.
7. As a developer investigating reconnect behavior, I want every trace to identify the project, run, cursor, subscription generation, renderer instance, and runtime instance, so that paired log lines do not masquerade as duplicate subscriptions.
8. As a developer maintaining the status stream, I want the healthy path to prove that the post-commit wake-up caused the durable reread, so that the 1,000 ms safety tick remains a fallback.
9. As a developer maintaining Apollo state, I want a new run inserted through the existing authoritative status contract, so that Studio does not retain a second server-state snapshot.
10. As a developer maintaining reconnects, I want stale subscription generations ignored, so that an old connection cannot overwrite a newer snapshot.
11. As a developer reviewing the fix, I want the restart gap, wake-up delay, unknown-run resync, and paired logs tested as separate claims, so that one development trace does not justify an unrelated rewrite.
12. As a maintainer, I want the smallest evidenced correction with a regression test, so that the race-free snapshot and replay protocol stays intact.

## Implementation decisions

- Add one structured launch-discovery trace with timestamps for transaction commit, wake-up publication, wake-up receipt, outbox reread, event queueing, frontend frame receipt, Apollo insertion, and first workspace render. Every record must carry the project, Agent Run, cursor when available, connection generation, renderer instance, and runtime instance.
- Capture a clean baseline only after one project subscription has emitted its caught-up frame. Run enough launches to state the observed median and slowest commit-to-render latency. Record whether each launch followed a wake-up or the safety reread.
- Reproduce restart recovery separately. A launch committed before subscription readiness must be found by the first snapshot or cursor replay after the replacement subscription starts.
- Explain paired subscription logs before changing ownership. Prove whether they come from two renderer instances, two runtime instances, duplicate forwarding, or two live subscriptions.
- Inventory Run now, task workspace launch, workflow-triggered launch, and other user-visible task launch entry points. Record which contracts return an Agent Run identity and which depend entirely on status discovery.
- CODING-1359 selects shared wake-up ownership as the primary correction. The correlated publisher and subscriber authority IDs differed, and no `wake-up-received` record occurred for the caught-up launches. The authoritative status payload and Apollo upsert are not first because no wake-up arrived. Duplicate subscription ownership is not proven because only one backend listener registered and React Strict Mode's duplicate setup accepted one generation. Keep the 1,000 ms durable reread as recovery.
- Keep the listener-before-high-water handshake, durable cursor replay, stale-generation rejection, bounded replay, and 1,000 ms safety reread.
- Keep Apollo's cache as the only owner of server Agent Run records. Launch feedback may write the acknowledged authoritative record into Apollo, but it must not create a parallel run store.
- Keep pending launch guards until acknowledgement or refusal. After acknowledgement, show the new run or its terminal immediately and bind later status facts to the same Agent Run identity.
- Record the proven root cause, healthy latency measurements, degraded recovery latency, and selected correction in the Story when implementation finishes.

## Testing decisions

- The main regression test belongs at the Studio acceptance seam because the failure is visible behavior across launch acknowledgement, status delivery, Apollo, and workspace rendering.
- Add numbered acceptance case `overhaul-186`. Start one project feed, deliver a snapshot and caught-up frame, perform one launch, acknowledge one Agent Run, then deliver the authoritative launch update. Assert that the run appears once without a second click, a second subscription, or an unknown-run reconnect.
- Make the acceptance test deterministic. Use controlled subscription frames and fake timers for debounces. Do not use a wall-clock sleep as proof of the 500 ms product budget.
- Keep focused status-feed tests for cursor ownership, unknown-run handling, and stale generations. Update the existing test for the corrected path instead of adding another lower-level seam that repeats the acceptance case.
- If the trace finds the fault in Rust wake-up delivery, add a focused Rust test that commits after caught-up and proves the listener triggers an immediate durable reread without advancing the 1,000 ms timer.
- If the trace finds two real subscriptions, add a lifecycle test that mounts the Studio shell under the reproducing conditions and proves one live subscription per renderer and project.
- Update the numbered overhaul matrix and run the full Studio overhaul gate before handoff.
- Tests must assert visible run identity, launch count, subscription count, and reconnect count. They must not assert private function calls or duplicate the status stream's internal implementation.

## Out of scope

- Creating implementation tickets during the Spec stage.
- Replacing GraphQL or adding a product REST API.
- Adding a second frontend store for Agent Runs.
- Reworking terminal rendering, tmux ownership, or unrelated launch policy.
- Removing durable replay or the safety reread.
- Treating development hot reload as the root cause unless correlated instance identifiers prove it.
- Broad subscription or cache rewrites that are not required by the measured delay.

## Further notes

The current evidence proves that persistence and snapshot application are fast. The 9-second example crossed a runtime restart, but the caught-up trace isolates the healthy-path fault: launch publication and status receipt used different live wake-up authorities, so the listener did not receive the post-commit wake-up.

The existing 250 ms unknown-run resync can explain part of a healthy launch delay, not the whole captured gap. The implementation should remove that reconnect from the successful caught-up launch path if the launch event already has enough authoritative data to create the run.
