"""A real ``gh`` on disk, standing in for the one spawn seam these tests fake.

Everything else in the pull-request path stays real: git is git, the repository
is a repository, the remote is a bare repository on disk, and the branch really
is pushed to it. Only GitHub itself cannot be reached from a test, so ``gh`` is
installed here as an ordinary executable on the same isolated ``PATH`` the
generator fakes already use — found by the production lookup, not by a patched
function.

The fake records what it was asked to do (its argv, and the body file's
contents) so a test can assert the *shape* of the call: that a body file was
used rather than an inline argument, that the head and base branches were named
explicitly, and that no token was ever passed.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from apps.source_control.tests.commit_fixtures import write_executable

#: Where the fake writes what it was asked, one file per subcommand.
ARGV_LOG = "gh-argv.log"
BODY_LOG = "gh-body.md"
ENVIRONMENT_LOG = "gh-env.log"

#: The fake's memory of having already opened a pull request. GitHub refuses a
#: second one for the same branch, so a fake that forgot would let a duplicate
#: look like a success and hide the behaviour worth testing.
OPENED_MARKER = "gh-opened"


def link_tool(bin_dir: Path, name: str) -> None:
    """Make one host binary reachable on the isolated ``PATH``.

    The isolated ``PATH`` holds only ``git`` so that no real generator CLI can
    decide a test's outcome. The fake ``gh`` needs a little more than shell
    builtins to read the body file back, and adding ``cat`` cannot resurrect a
    generator — nothing in the fallback order is named ``cat``.
    """

    target = shutil.which(name, path=os.defpath)
    assert target, f"these tests require {name} on the host"
    link = bin_dir / name
    if not link.exists():
        os.symlink(target, link)


def install_gh(
    bin_dir: Path,
    logs: Path,
    *,
    authenticated: bool = True,
    create_exit: int = 0,
    create_prints: str = "",
    view_prints: str = "",
) -> Path:
    """Install a ``gh`` on ``PATH`` that answers the three calls this app makes.

    ``gh auth status`` decides whether the user is logged in, ``gh pr create``
    decides what GitHub did, and ``gh pr view`` supplies the fallback URL
    lookup. Each is dispatched on argv exactly as the real CLI would be, so a
    test that changes one leaves the others behaving normally.
    """

    link_tool(bin_dir, "cat")
    link_tool(bin_dir, "env")
    logs.mkdir(parents=True, exist_ok=True)
    argv_log = logs / ARGV_LOG
    body_log = logs / BODY_LOG
    environment_log = logs / ENVIRONMENT_LOG
    marker = _quoted(str(logs / OPENED_MARKER))
    existing_url = _url_in(create_prints) or _url_in(view_prints)

    script = f"""
echo "$@" >> {_quoted(str(argv_log))}
env >> {_quoted(str(environment_log))}
if [ "$1" = "auth" ]; then
  exit {0 if authenticated else 1}
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  if [ -f {marker} ]; then
    echo "a pull request for this branch already exists: {existing_url}"
    exit 1
  fi
  previous=""
  for argument in "$@"; do
    if [ "$previous" = "--body-file" ]; then
      cat "$argument" > {_quoted(str(body_log))}
    fi
    previous="$argument"
  done
{_prints(create_prints)}
  if [ {create_exit} -eq 0 ]; then
    : > {marker}
  fi
  exit {create_exit}
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
{_prints(view_prints)}
  exit {0 if view_prints else 1}
fi
exit 1
""".strip()
    return write_executable(bin_dir / "gh", script)


def _url_in(text: str) -> str:
    """The pull request URL the fake was configured to print, if it has one."""

    for word in text.split():
        if word.startswith("http") and "/pull/" in word:
            return word
    return ""


def _prints(text: str) -> str:
    """``text`` as echo lines, indented to sit inside the dispatch block."""

    return "\n".join(f"  echo {_quoted(line)}" for line in text.splitlines())


def _quoted(text: str) -> str:
    """``text`` as one single-quoted shell word."""

    return "'" + text.replace("'", "'\"'\"'") + "'"


def recorded_argv(logs: Path) -> list[str]:
    """Every ``gh`` invocation's arguments, in the order they were made."""

    path = logs / ARGV_LOG
    return path.read_text().splitlines() if path.exists() else []


def recorded_body(logs: Path) -> str:
    """The body file's contents as the fake ``gh`` read them."""

    path = logs / BODY_LOG
    return path.read_text() if path.exists() else ""


def recorded_environment(logs: Path) -> str:
    """Everything the fake ``gh`` was given in its environment."""

    path = logs / ENVIRONMENT_LOG
    return path.read_text() if path.exists() else ""
