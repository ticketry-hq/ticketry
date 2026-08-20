# Startup prompts in argv, manual entry skills through tmux

Ticketry passes the full composed prompt to the provider command, as it did
before entry skills were added. The run stores that exact startup prompt. This
path already handles large prompts through a private run-scoped wrapper when a
tmux command would exceed the safe control-message size.

An entry skill is different. Pinned workflow skills carry
`disable-model-invocation: true`, so the provider must receive the slash command
as manual input. Once the pane matches the provider's ready marker, Ticketry
types and submits only the provider's manual invocation. Claude uses
`/<entry-skill>` and Codex uses `$<entry-skill>`. Runs without an entry skill do
not wait for readiness and receive no typed launch input. Ticketry presses
Enter twice because provider completion menus can consume the first press to
accept the skill rather than submit the line.

Keeping the two channels separate avoids rendering the full prompt in the TUI.
Codex collapses long pasted input into a placeholder, so checking for the
prompt's literal trailing text caused every large prompt to time out before
Ticketry pressed Enter. The single-line skill command remains visible and can
be confirmed without that failure mode.

A provider resume starts its native resume command, waits for the composer,
and stages `continue` without submitting it. Neither path schedules input after
the launch operation returns control to the user.

## Considered Options

Passing the slash command in argv does not work. The CLI treats it as prompt
text, and the skill's block on model invocation remains in force.

Stripping `disable-model-invocation` from Ticketry's installed copies (with or
without renaming them `ticketry-*`) was the strongest alternative. It is
deterministic and needs no readiness detection, but it changes skill semantics
the author deliberately set — the agent could then invoke the skill
spontaneously in unrelated sessions — and it does nothing for users whose
pre-installed upstream copies keep the flag. It remains the fallback if
readiness detection proves unreliable in practice.

Typing `/<entry-skill> <full prompt>` was implemented first. It failed because
large TUI pastes are not guaranteed to render their literal contents.

Fixed post-launch delays were rejected because provider startup time varies.

## Consequences

Only entry-skill launches and resumes depend on recognising provider readiness.
A marker change breaks manual skill invocation for that provider and produces
the existing explicit "prompt delivery failed" run state.

The full startup prompt remains in argv and in the persisted run record. The
terminal transcript shows the short manual skill command separately.
