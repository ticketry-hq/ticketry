"""The headless CLIs that can write a commit message, and how to run them.

This module is the process-spawn boundary for message generation: it knows the
four supported CLIs, how each one takes a one-shot prompt, and how to find the
binary. Nothing above it spawns a process, so a test substitutes a generator by
pointing this app's approved-path variable at a script — the same convention
the terminal launcher already uses for approved agent binaries.

Generation is best-effort by design. A CLI that is missing, slow, broken, or
silent returns ``None`` and the caller falls through to the next one; commit is
never blocked on an LLM (CODING-961, user story 15).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

#: Fallback order, fixed by the HLD: claude, then codex, then gemini, then
#: opencode. A configured preference is tried ahead of this, not instead of it.
GENERATOR_ORDER = ("claude", "codex", "gemini", "opencode")

#: Wall-clock budget for one generation attempt. A CLI slower than this is
#: treated as absent so the commit still lands.
GENERATOR_TIMEOUT_SECONDS = 90.0

#: Largest stdout a generator may return. A subject line needs a few hundred
#: bytes; anything past this is a CLI that misunderstood the prompt.
GENERATOR_OUTPUT_LIMIT_BYTES = 64 * 1024


@dataclass(frozen=True)
class Generator:
    """One headless CLI and its one-shot invocation."""

    name: str
    #: Environment variable naming an operator-approved binary, if set.
    approved_path_env: str
    #: The binary to look for on PATH when no approved path is configured.
    binary: str
    #: Arguments that precede the prompt in a one-shot run.
    prompt_arguments: tuple[str, ...]

    def argv(self, executable: str, prompt: str) -> list[str]:
        return [executable, *self.prompt_arguments, prompt]


GENERATORS: dict[str, Generator] = {
    "claude": Generator(
        name="claude",
        approved_path_env="MUXED_APPROVED_CLAUDE_PATH",
        binary="claude",
        prompt_arguments=("-p",),
    ),
    "codex": Generator(
        name="codex",
        approved_path_env="MUXED_APPROVED_CODEX_PATH",
        binary="codex",
        prompt_arguments=("exec",),
    ),
    "gemini": Generator(
        name="gemini",
        approved_path_env="MUXED_APPROVED_GEMINI_PATH",
        binary="gemini",
        prompt_arguments=("-p",),
    ),
    "opencode": Generator(
        name="opencode",
        approved_path_env="MUXED_APPROVED_OPENCODE_PATH",
        binary="opencode",
        prompt_arguments=("run",),
    ),
}


def installed_executable(generator: Generator) -> str | None:
    """The binary to run for ``generator``, or ``None`` if it is not here."""

    approved = os.environ.get(generator.approved_path_env, "").strip()
    if approved:
        return approved if os.path.isfile(approved) else None
    return shutil.which(generator.binary)


def _environment() -> dict[str, str]:
    env = dict(os.environ)
    # A generator must never open an editor, page its output, or stop for a
    # terminal it does not have.
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_PAGER"] = "cat"
    env["PAGER"] = "cat"
    env["NO_COLOR"] = "1"
    env["TERM"] = "dumb"
    return env


def run_generator(generator: Generator, *, prompt: str, cwd: str) -> str | None:
    """One generation attempt, or ``None`` when this CLI cannot answer."""

    executable = installed_executable(generator)
    if executable is None:
        return None

    try:
        completed = subprocess.run(
            generator.argv(executable, prompt),
            capture_output=True,
            cwd=cwd,
            env=_environment(),
            timeout=GENERATOR_TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        # Missing, not executable, killed, or over its budget — all the same
        # answer to the caller: this CLI did not produce a message.
        return None

    if completed.returncode != 0:
        return None
    raw = (completed.stdout or b"")[:GENERATOR_OUTPUT_LIMIT_BYTES]
    text = raw.decode("utf-8", errors="replace").strip()
    return text or None
