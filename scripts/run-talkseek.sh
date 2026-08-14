#!/usr/bin/env bash
#
# Run the Talkseek video app's tickets, one at a time.
#
# A thin wrapper over run-subtree-serially.sh with Talkseek's root and repo
# baked in, so there is nothing to remember and nothing to mistype. Everything
# that script supports still works:
#
#   PLAN=1    ./scripts/run-talkseek.sh    print the launch order, change nothing
#   DRY_RUN=1 ./scripts/run-talkseek.sh    print the next launch only
#   NO_PUSH=1 ./scripts/run-talkseek.sh    commit each ticket, never push
#   INTERVAL=60 ./scripts/run-talkseek.sh  check more often than every 2 minutes
#
# Talkseek is a module rather than a Story, so the runner reads the module
# listing instead of a dependency graph. That listing carries each ticket's full
# blocker set, including blockers in other phases — which matters here, because
# Phase 1 tickets are blocked by Phase 0A tickets.
#
# The 9 phase Stories are containers and are not launched; only the ~55
# Implementation tickets beneath them are.
#
set -euo pipefail

# The talkseek module in the coding project.
TALKSEEK_MODULE_ID="9651f1da-5266-4292-a756-3b42ec6e3974"
TALKSEEK_REPO="${TALKSEEK_REPO:-$HOME/merge_conflicts/personal/Videos}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -d "$TALKSEEK_REPO/.git" ]]; then
  echo "Talkseek repo not found at $TALKSEEK_REPO" >&2
  echo "Set TALKSEEK_REPO to its checkout." >&2
  exit 66
fi

# Committing to a shared branch unattended, 55 times, deserves a look first.
branch="$(git -C "$TALKSEEK_REPO" branch --show-current)"
if [[ "${PLAN:-0}" != "1" && "${DRY_RUN:-0}" != "1" && "${NO_COMMIT:-0}" != "1" ]]; then
  if [[ "$branch" == "main" || "$branch" == "master" ]] && [[ "${NO_PUSH:-0}" != "1" ]]; then
    echo "Talkseek is on '$branch' and pushing is enabled." >&2
    echo "Each of ~55 tickets would commit and push to '$branch' unreviewed." >&2
    echo >&2
    echo "  git -C $TALKSEEK_REPO switch -c talkseek-serial-run   # work on a branch" >&2
    echo "  NO_PUSH=1 $0                                          # commit only" >&2
    echo "  ALLOW_MAIN=1 $0                                       # proceed anyway" >&2
    [[ "${ALLOW_MAIN:-0}" == "1" ]] || exit 65
  fi
fi

REPO="$TALKSEEK_REPO" exec "$here/run-subtree-serially.sh" "$TALKSEEK_MODULE_ID" "$@"
