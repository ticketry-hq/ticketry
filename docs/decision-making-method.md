# How we make architecture decisions

A method, extracted from the session that produced
[`decisions/2026-08-04-frontend-state-and-api-contract.md`](decisions/2026-08-04-frontend-state-and-api-contract.md).
That session began as a one-line bug ticket ("update the task name in the task
list when it changes on the details page") and ended with a backend framework
change, a frontend state-layer rebuild, and two previously-planned projects
re-opened. The reasoning that got there is more reusable than the conclusions,
so it is written down separately.

This document is prescriptive. It is the process to follow next time.

---

## 1. Establish facts before arguing about them

Every claim about the system gets looked up, not recalled. In the source
session this meant reading the render path, grepping for callers, counting
lines, and querying the OpenAPI document — before any option was put on the
table.

The rule that makes this work: **a fact that can be discovered is never a
question for the decision-maker.** Their time is for decisions. If someone
asks "does the picker need project-wide candidates?" that is a decision (a
product intent). If someone asks "which query key does the tree read?" that is
a fact, and asking it wastes the one scarce resource in the room.

Consequence: expect roughly two-thirds of the effort to be discovery, and
expect the discovery to change the question. In the source session the
originally-framed question ("how do we sync the task name?") was the wrong
question, and only the counting revealed it.

## 2. Descend three layers: symptom → mechanism → manufacture

Stopping at the mechanism produces a patch. Stopping at the symptom produces a
workaround. The third descent is where the durable fix lives.

| Layer | Question | In the source session |
| --- | --- | --- |
| Symptom | What does the user see? | A renamed Story keeps its old name in the list |
| Mechanism | What code makes that happen? | The list renders a second, lossy copy of the record that the edit path never touches |
| Manufacture | What made that mechanism possible — or inevitable? | The API offers the same rows at four levels of filtering, so a request-keyed cache faithfully stores four copies; and nothing ever failed when a copy appeared |

Only at the third layer does the fix stop being "sync these two things."

Ask explicitly: *what would have had to be true for this bug to be impossible?*
If the answer is "someone would have had to remember," you are still one layer
short.

## 3. Check stated intent against reality

Architecture documents assert things. Verify each assertion you intend to rely
on. In the source session, an ADR stated in the past tense that a type had been
deleted, and a glossary asserted that a record "can never exist in two places
and disagree with itself." Both were false, and the bug under investigation was
the proof.

This is not a criticism of documentation — it is a warning about how to read
it. **Treat a design document as a statement of intent with an unknown
implementation status.** When intent and reality disagree, that gap is itself
the most valuable finding in the room, because it tells you the previous
attempt did not fail at the design stage. It failed at the deletion stage.

## 4. Let the diagnosis move upstream

The bug was reported against the frontend. The frontend was guilty. But the
frontend was guilty of *compounding* something the API contract manufactured,
and the decisive reframing came from the decision-maker, not the investigator:
*"The problem is not just the front end here."*

Guard against boundary-bound investigation. When a defect class keeps
reappearing inside one component, ask what that component is being handed.
The test: if the upstream contract were different, would the downstream
mistake still have been *available* to make? If the answer is no, the upstream
contract is part of the defect.

## 5. Judge a proposal against the failure history, not its own merits

Every candidate solution in the source session was individually reasonable.
The one that survived did so because of a different test: **would this have
prevented what actually happened?**

Applied to a real case: two prior overhauls had each introduced a correct new
mechanism and left the previous one alive behind a compatibility shim. So a
proposal to introduce a *third* correct mechanism was scored not on its
elegance but on whether it forced the deletion of the other two. Several
attractive options failed that test, including one the investigator had
recommended.

Corollary: **"the tool failed" and "the discipline failed" demand different
remedies, and are easy to confuse.** If the same mistake recurs across two
different tools, the tool is not the variable. Changing it again is motion
without progress.

## 6. Prefer enforcement to documentation for anything invariant

If a rule matters, something must fail when it breaks. Prose cannot fail.
An invariant recorded only in an ADR or a glossary has no mechanism of action,
and the source session found two such invariants that had been silently false
for months.

Rank remedies by what has to happen for the rule to be violated:

1. **Structurally impossible** — the shape of the code admits no violation.
2. **Fails to compile** — a type prohibits it.
3. **Fails the build** — a test asserts it.
4. **Visible as an eyesore** — a convention makes deviation conspicuous, and
   deviations are quarantined in a named place rather than scattered.
5. **Written down** — no mechanism of action. Necessary for *why*; never
   sufficient for *whether*.

Levels 1–3 are worth paying for. Level 4 is worth designing for when 1–3 are
impractical: it is the reason a constrained, conventional core beats a surface
of equally-bespoke handlers, because it makes the exceptions countable.
Level 5 alone is how you get here twice.

## 7. Prefer the invariant you can carry to the one you can inherit

A guarantee borrowed from a framework only lasts as long as the framework. In
the source session a framework was chosen partly for the convention it
enforces — and then a check of the *planned replacement platform* found the
convention did not exist there. The convention would have been lost at the
port.

So: when a rule is meant to outlive the current stack, the durable artefact is
your own declaration plus a conformance check written against something both
stacks have (a route table, a schema, an HTTP response). The framework becomes
an accelerator that makes the rule cheap today, not the thing the rule depends
on.

## 8. Verify claims about other ecosystems; never assert them

Ecosystem claims decay fast and are the easiest place to be confidently wrong.
The source session's most consequential single finding — that the planned
target platform did *not* provide the property being purchased — came from
looking it up mid-conversation, and it re-opened a project that had a 766-line
design document.

If a decision leans on "X supports Y," check it, cite it, and state the
knowledge boundary if you cannot.

## 9. Distrust tests that encode the defect

A test suite is a specification of current behaviour, including the parts that
are wrong. In the source session it was briefly proposed that the existing API
tests act as the conformance harness for the rewrite — until the
decision-maker pointed out those tests *assert* that several endpoints return
overlapping views of the same data. They specified the defect.

Before reusing a suite across a redesign, sort it:

- **Domain-rule tests** — assert behaviour that must hold whatever the
  interface looks like. These are the asset. They usually live below the
  interface being changed, which is also the argument for putting them there.
- **Shape tests** — assert the interface itself. These encode the design under
  replacement and must be re-authored, not preserved.

The ratio tells you how much of the suite is load-bearing. A suite that is
mostly shape tests is a suite that will break at every redesign, and that fact
is worth surfacing as its own finding.

## 10. Separate reversible decisions from load-bearing ones, and say which is which

Not every choice deserves equal scrutiny. In the source session one decision
was explicitly labelled as the least load-bearing of the set — and the
decision-maker was right to push back on it, because it had been presented as
a consequence of another decision when it was actually independent.

Two habits follow. **Say out loud when a decision is cheap to reverse**, so
scrutiny goes where it belongs. And **never let a decision ride along as an
implication of another one**; if it is separable, separate it and put it
explicitly.

## 11. Re-open earlier decisions when a later fact invalidates their premise

Decisions in a long session form a dependency graph, and discoveries
invalidate premises upstream. This happened twice in the source session: a
transport choice was reversed by a fact about a planned rewrite, and a
state-ownership choice was reversed by a better statement of the orthodox
pattern.

Reversal is not churn if the premise genuinely moved. Make it cheap: state the
premise a decision rests on at the moment you make it, so you can tell later
whether it still holds. And when reversing, say plainly which earlier decision
is being withdrawn and why — an undocumented reversal reads as inconsistency
to everyone who was not present.

## 12. State a concern once, then execute the decision

The investigator's job includes surfacing costs the decision-maker may not
have priced — scope, blast radius, lost safety nets. It does not include
re-litigating. In the source session two decisions were taken against the
investigator's recommendation after the cost was stated; the correct behaviour
was to record the concern once, note it in the artefacts, and proceed at full
effort.

Judgement about *whether* the cost is worth paying belongs to the person who
pays it. Do not scale the work down unilaterally, and do not keep re-raising a
settled point. Write it in the record instead — that is what the record is for.

---

## The shape of a good session

1. Read the code until the reported symptom is fully mechanically explained.
2. Descend to what manufactured the mechanism.
3. Verify the stated intent (ADRs, glossaries, design docs) against reality.
4. Enumerate the candidate approaches, and score each against *what actually
   went wrong here*, not against its own merits.
5. Put decisions — not facts — to the owner, one at a time, each with a
   recommendation and its premise stated.
6. When a new fact invalidates an earlier premise, say so and re-open it.
7. Decide how the invariant is *enforced*, not just what it is.
8. Sort the test suite into domain rules and shape assertions before promising
   anything about migration cost.
9. Record decisions, rejected alternatives, and the reasons — especially the
   rejections, or they get re-proposed in six months.
