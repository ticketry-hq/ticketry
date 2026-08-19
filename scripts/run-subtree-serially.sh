#!/usr/bin/env bash
#
# Run a WorkTracker subtree one ticket at a time.
#
#   launch the lowest-numbered ready ticket
#     -> sleep INTERVAL
#     -> has it reached Review?  yes: launch the next one
#                                no:  sleep INTERVAL again
#
# Only ever one run in flight. Unlike `execute-graph`, which arms a root and
# launches every eligible child at once, this walks the frontier serially.
#
# The agent, model and reasoning come from the launch binding on the ticket's
# current workflow state — for these tickets, the Implement state of the CODING
# project. There is no per-launch model or reasoning override in the API, so if
# you want codex/high, that binding is where it is set. Check it in Settings
# before starting a long run.
#
# Usage:
#   scripts/run-subtree-serially.sh <root-work-item-uuid>
#   scripts/run-subtree-serially.sh 209c7473-36f6-4d91-b36d-49bbce965040
#
# The root may be a work item (uses its dependency graph) or a module (uses the
# module listing, which carries each ticket's full blocker set).
#
# Environment:
#   INTERVAL           seconds between checks              (default 120)
#   MAX_TICKET_MINUTES give up on one ticket after this    (default 90)
#   AGENT              override just the agent, e.g. codex (default: unset,
#                      so the state's launch binding decides everything)
#   REPO               repo to commit in (default: this script's repo)
#   NO_COMMIT          1 = do not commit or push at all
#   NO_PUSH            1 = commit but never push
#   NO_CHECKPOINT      1 = do not checkpoint a dirty tree before starting
#   PROJECT_ID         required when the root is a module, unused otherwise
#   PLAN               1 = print the full launch order and exit
#   DRY_RUN            1 = print the next launch only, launch nothing
#   WORKTRACKER_BASE_URL  default http://127.0.0.1:8787/api/work-tracker
#   WORKTRACKER_API_KEY   sent as x-api-key when set
#
set -euo pipefail

ROOT_ID="${1:-}"
if [[ -z "$ROOT_ID" ]]; then
  echo "usage: $0 <root-work-item-uuid>" >&2
  exit 64
fi

INTERVAL="${INTERVAL:-120}"
MAX_TICKET_MINUTES="${MAX_TICKET_MINUTES:-90}"
DRY_RUN="${DRY_RUN:-0}"
# Only needed when the root is a module: a module has no work-item record to
# read the project from, so state names cannot be resolved without it.
PROJECT_ID="${PROJECT_ID:-}"
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NO_COMMIT="${NO_COMMIT:-0}"
NO_PUSH="${NO_PUSH:-0}"
BASE="${WORKTRACKER_BASE_URL:-http://127.0.0.1:8787/api/work-tracker}"
BASE="${BASE%/}"
# Note: scripts/worktracker_dependency_poller.py still calls the pre-DRF route
# (/api/work-items/{id}/dependency-graph). The graph now lives at
# {BASE}/work-items/{id}/graph-run. That poller needs the same correction.

FINISHED='Review Done Canceled Cancelled'
UNBLOCKING='Review Done'

say() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }

api() {                                    # api <METHOD> <URL> [BODY]
  local method="$1" url="$2" body="${3:-}"
  local -a args=(--silent --show-error --fail-with-body --max-time 20
                 -X "$method" -H 'Accept: application/json')
  [[ -n "${WORKTRACKER_API_KEY:-}" ]] && args+=(-H "x-api-key: ${WORKTRACKER_API_KEY}")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}" "$url"
}

# Ready = not the root, not finished, and every blocker is in Review or Done.
# Prints one id per line.
ready_ids() {
  python3 -c '
import json,sys
graph=json.load(sys.stdin); root=sys.argv[1]
fin=set(sys.argv[2].split()); unb=set(sys.argv[3].split())
nodes={n["id"]:n for n in graph.get("nodes",[])}
# A node with children is a container — a phase or an umbrella Story — not work.
# Launching one would run an agent against a parent, in whatever state that
# parent happens to sit in.
parents={n.get("parent_id") for n in nodes.values() if n.get("parent_id")}
for i,n in nodes.items():
    if i==root or i in parents or n.get("state") in fin: continue
    if all(nodes.get(b,{}).get("state") in unb for b in n.get("blocked_by",[])):
        print(i)
' "$ROOT_ID" "$FINISHED" "$UNBLOCKING"
}

node_state() {                             # node_state <graph-json> <id>
  printf '%s' "$1" | python3 -c '
import json,sys
g=json.load(sys.stdin)
print(next((n.get("state","?") for n in g.get("nodes",[]) if n["id"]==sys.argv[1]),"MISSING"))
' "$2"
}

field() {                                  # field <id> <json-key>
  api GET "$BASE/work-items/$1" | python3 -c '
import json,sys
print(json.load(sys.stdin).get(sys.argv[1]) or "")
' "$2"
}

# The graph projection lists only blockers that live inside the subtree, so a
# dependency on a ticket elsewhere is invisible to it. Check the candidate's own
# blocker list instead, and resolve each blocker's state by id.
UNBLOCKING_STATE_IDS=''
SUBTREE_IDS=''

load_subtree_ids() {                     # load_subtree_ids <graph-json>
  SUBTREE_IDS="$(printf '%s' "$1" | python3 -c '
import json,sys
print(" ".join(n["id"] for n in json.load(sys.stdin).get("nodes",[])))')"
}

STATE_NAMES_JSON=''
MODULE_MODE=0

load_state_names() {                     # load_state_names <project-id>
  STATE_NAMES_JSON="$(api GET "$BASE/projects/$1/states" | python3 -c '
import json,sys
d=json.load(sys.stdin); rows=d.get("results",d) if isinstance(d,dict) else d
print(json.dumps({str(r["id"]): r["name"] for r in rows}))')"
}

# A module is not a work item, so it has no graph-run. Its listing carries each
# item's FULL blocker set though — including blockers in other modules, which
# graph-run filters out — so the synthesised graph is strictly better.
fetch_graph() {
  local out
  if out="$(api GET "$BASE/work-items/$ROOT_ID/graph-run" 2>/dev/null)"; then
    MODULE_MODE=0; printf '%s' "$out"; return 0
  fi
  MODULE_MODE=1
  if [[ -z "$PROJECT_ID" ]]; then
    echo "error: the root is a module, so PROJECT_ID must be set" >&2
    echo "usage: PROJECT_ID=<project-uuid> $0 <root-module-uuid>" >&2
    exit 64                                # usage error — the caller must not retry
  fi
  [[ -z "$STATE_NAMES_JSON" ]] && load_state_names "$PROJECT_ID"
  api GET "$BASE/work-items?module=$ROOT_ID" | python3 -c '
import json,sys
names=json.loads(sys.argv[1])
d=json.load(sys.stdin); rows=d.get("results",d) if isinstance(d,dict) else d
print(json.dumps({"nodes":[{
    "id": str(r["id"]),
    "state": names.get(str(r.get("state")), "?"),
    "parent_id": r.get("parent_id"),
    "blocked_by": [str(b) for b in (r.get("blocked_by_ids") or [])],
} for r in rows]}))' "$STATE_NAMES_JSON"
}

load_unblocking_state_ids() {            # load_unblocking_state_ids <project-id>
  UNBLOCKING_STATE_IDS="$(api GET "$BASE/projects/$1/states" | python3 -c '
import json,sys
want=set(sys.argv[1].split())
data=json.load(sys.stdin)
rows=data.get("results",data) if isinstance(data,dict) else data
print(" ".join(r["id"] for r in rows if r.get("name") in want))
' "$UNBLOCKING")"
}

# Only external blockers are checked here. Blockers inside the subtree are the
# graph's job, and it already reports them; checking those again would just
# rediscover them one at a time and hide the external one behind them.
blockers_satisfied() {                   # blockers_satisfied <id> -> 0 if clear
  local id="$1" blocker st unsatisfied=''
  for blocker in $(api GET "$BASE/work-items/$id" | python3 -c '
import json,sys
print(" ".join(json.load(sys.stdin).get("blocked_by_ids") or []))'); do
    [[ " $SUBTREE_IDS " == *" $blocker "* ]] && continue
    st="$(field "$blocker" state)"
    if [[ " $UNBLOCKING_STATE_IDS " != *" $st "* ]]; then
      unsatisfied="${unsatisfied}${unsatisfied:+, }$(field "$blocker" key)"
    fi
  done
  [[ -z "$unsatisfied" ]] && return 0
  BLOCKED_REASON="$unsatisfied"
  return 1
}

# Ticket order is the order they were created in, which is dependency order.
# The graph gives no ordering, so sort the ready set by sequence id.
lowest_ready() {
  local best_id='' best_seq=999999 id seq
  while read -r id; do
    [[ -z "$id" ]] && continue
    seq="$(field "$id" sequence_id)"
    [[ -z "$seq" ]] && seq=999999
    if (( seq < best_seq )); then best_seq="$seq"; best_id="$id"; fi
  done
  printf '%s' "$best_id"
}

git_in() { git -C "$REPO" "$@"; }

# The script cannot tell one ticket's files from another's, so it commits the
# whole tree. That is only meaningful if the tree starts clean — otherwise the
# first ticket's commit swallows everything already uncommitted. Checkpoint it.
checkpoint_dirty_tree() {
  # A dry run must change nothing, including the git tree.
  [[ "$NO_COMMIT" == "1" || "$DRY_RUN" == "1" || "${NO_CHECKPOINT:-0}" == "1" ]] && return 0
  local n; n="$(git_in status --porcelain | wc -l | tr -d ' ')"
  [[ "$n" == "0" ]] && return 0
  say "! $n uncommitted files in $REPO"
  say "  checkpointing them so the first ticket's commit is only its own work"
  git_in add -A
  git_in commit -q -m "Checkpoint before serial run

Work in progress at the start of the run, committed so that each ticket's
commit contains only that ticket's changes." || true
  say "  checkpointed $(git_in rev-parse --short HEAD)"
}

commit_and_push() {                      # commit_and_push <key> <name>
  [[ "$NO_COMMIT" == "1" || "$DRY_RUN" == "1" ]] && return 0
  if [[ -z "$(git_in status --porcelain)" ]]; then
    # Expected when the agent worked in its own worktree rather than here.
    say "  nothing to commit in $REPO"
    return 0
  fi
  git_in add -A
  git_in commit -q -m "$1 $2" || { say "  ! commit failed"; return 0; }
  say "  committed $(git_in rev-parse --short HEAD)  $1"
  if [[ "$NO_PUSH" == "1" ]]; then say "  push skipped (NO_PUSH)"; return 0; fi
  if git_in push -q 2>/dev/null; then say "  pushed"; else say "  ! push failed — carrying on"; fi
}

# PLAN: replay the loop's own choice — take the lowest-numbered ready ticket,
# pretend it reached Review, repeat — so the printed order is exactly the order
# the run will take.
if [[ "${PLAN:-0}" == "1" ]]; then
  graph="$(fetch_graph)"
  load_subtree_ids "$graph"
  meta="$(mktemp)"; trap 'rm -f "$meta"' EXIT
  for id in $(printf '%s' "$graph" | python3 -c '
import json,sys
for n in json.load(sys.stdin).get("nodes",[]): print(n["id"])'); do
    [[ "$id" == "$ROOT_ID" ]] && continue
    [[ -z "$UNBLOCKING_STATE_IDS" ]] && load_unblocking_state_ids "$(field "$id" project_id)"
    BLOCKED_REASON=''
    blockers_satisfied "$id" || true
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "$id" "$(field "$id" sequence_id)" "$(field "$id" key)" \
      "$BLOCKED_REASON" "$(field "$id" name)" >>"$meta"
  done
  printf '%s' "$graph" | python3 -c '
import json,sys
graph=json.load(sys.stdin)
root, fin, unb, path = sys.argv[1], set(sys.argv[2].split()), set(sys.argv[3].split()), sys.argv[4]
meta={}
for line in open(path):
    i,seq,key,blocked,name = line.rstrip("\n").split("\t",4)
    meta[i]={"seq":int(seq or 10**6),"key":key,"name":name,"blocked":blocked}
allnodes={n["id"]:n for n in graph.get("nodes",[])}
parents={n.get("parent_id") for n in allnodes.values() if n.get("parent_id")}
nodes={i:n for i,n in allnodes.items() if i!=root and i not in parents}
state={i:n.get("state") for i,n in nodes.items()}
step=1
while True:
    # Same rule as ready_ids: a blocker outside this subtree is NOT satisfied,
    # because the graph cannot see its state. Planning optimistically here
    # would promise an order the run will not take.
    ready=[i for i,n in nodes.items()
           if state[i] not in fin
           and all(state.get(b) in unb for b in n.get("blocked_by",[]))]
    if not ready: break
    nxt=min(ready,key=lambda i:meta.get(i,{}).get("seq",10**6))
    m=meta.get(nxt,{})
    # A blocker outside the subtree is invisible to the graph, so flag any that
    # is unsatisfied right now. The run will stop and wait at that ticket.
    hold=" <-- WAITS for %s" % m["blocked"] if m.get("blocked") else ""
    print("%2d. %-12s %s%s" % (step, m.get("key","?"), m.get("name","?"), hold))
    state[nxt]="Review"; step+=1
stuck=[i for i in nodes if state[i] not in fin]
if stuck:
    print("\nthen it stalls. Waiting on something this subtree cannot see:")
    for i in sorted(stuck,key=lambda i:meta.get(i,{}).get("seq",10**6)):
        outside=[b for b in nodes[i].get("blocked_by",[]) if b not in nodes]
        why=" (blocked outside the subtree)" if outside else ""
        print("   %-12s %s%s" % (meta.get(i,{}).get("key","?"),
                                 meta.get(i,{}).get("name","?"), why))
' "$ROOT_ID" "$FINISHED" "$UNBLOCKING" "$meta"
  exit 0
fi

checkpoint_dirty_tree
say "root      $ROOT_ID"
say "interval  ${INTERVAL}s, giving up on a ticket after ${MAX_TICKET_MINUTES}m"
[[ "$DRY_RUN" == "1" ]] && say "DRY RUN — nothing will be launched"
[[ -n "${AGENT:-}" ]] && say "agent override: ${AGENT} (model and reasoning still come from the binding)"

current=''                                 # the ticket we launched
current_key=''
current_name=''
waited=0

while true; do
  rc=0; graph="$(fetch_graph)" || rc=$?
  if (( rc == 64 )); then exit 1; fi       # usage error already printed
  if (( rc != 0 )); then
    say "! cannot reach the graph — retrying in ${INTERVAL}s"
    sleep "$INTERVAL"; continue
  fi

  load_subtree_ids "$graph"
  root_state="$(node_state "$graph" "$ROOT_ID")"
  if [[ " $UNBLOCKING " == *" $root_state "* ]]; then
    say "root reached $root_state — everything is done"; exit 0
  fi
  if [[ "$MODULE_MODE" == "1" && -z "$current" ]] && \
     [[ -z "$(ready_ids <<<"$graph")" ]] && \
     [[ -z "$(printf '%s' "$graph" | python3 -c '
import json,sys
fin=set(sys.argv[1].split())
print("x" if any(n.get("state") not in fin for n in json.load(sys.stdin).get("nodes",[])) else "")
' "$FINISHED")" ]]; then
    say "every ticket in this module is finished"; exit 0
  fi

  if [[ -n "$current" ]]; then
    state="$(node_state "$graph" "$current")"
    if [[ " $UNBLOCKING " == *" $state "* ]]; then
      say "✓ $current_key reached $state"
      commit_and_push "$current_key" "$current_name"
      current=''; waited=0
      continue                             # launch the next one immediately
    fi
    if [[ " $FINISHED " == *" $state "* ]]; then
      say "! $current_key ended as $state — stopping rather than guessing"; exit 1
    fi

    waited=$(( waited + INTERVAL ))
    if (( waited >= MAX_TICKET_MINUTES * 60 )); then
      say "! $current_key still $state after ${MAX_TICKET_MINUTES}m — stopping"
      say "  check its terminal; rerun this script to carry on from here"
      exit 1
    fi
    say "· $current_key is $state (${waited}s) — waiting"
    sleep "$INTERVAL"; continue
  fi

  next="$(ready_ids <<<"$graph" | lowest_ready)"
  if [[ -z "$next" ]]; then
    say "nothing ready and nothing running — waiting ${INTERVAL}s"
    sleep "$INTERVAL"; continue
  fi

  next_key="$(field "$next" key)"
  next_name="$(field "$next" name)"

  if [[ -z "$UNBLOCKING_STATE_IDS" ]]; then
    load_unblocking_state_ids "$(field "$next" project_id)"
  fi
  BLOCKED_REASON=''
  if ! blockers_satisfied "$next"; then
    say "· $next_key is waiting on $BLOCKED_REASON, which the graph does not show — waiting"
    sleep "$INTERVAL"; continue
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    say "would launch $next_key — $next_name"; exit 0
  fi

  body='{}'
  [[ -n "${AGENT:-}" ]] && body="$(printf '{"agent":"%s"}' "$AGENT")"

  say "▶ launching $next_key — $next_name"
  if ! out="$(api POST "$BASE/work-items/$next/launch-agent" "$body")"; then
    say "! launch refused: $out"; exit 1
  fi
  say "  $(printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("agent",d.get("agent"),"run",d.get("agent_run_id"))' 2>/dev/null || printf '%s' "$out")"

  current="$next"; current_key="$next_key"; current_name="$next_name"; waited=0
  sleep "$INTERVAL"
done
