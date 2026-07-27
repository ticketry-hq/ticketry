#!/usr/bin/env python3
"""Detached WorkTracker dependency-graph poller."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


UNBLOCKING_STATES = {"Review", "Done"}
ROOT_EXIT_STATES = {"Review", "Done"}
FINISHED_STATES = {"Review", "Done", "Canceled", "Cancelled"}


def api_root() -> str:
    explicit = os.getenv("WORKTRACKER_API_ROOT")
    if explicit:
        return explicit.rstrip("/")
    base = os.getenv("WORKTRACKER_BASE_URL", "http://127.0.0.1:8787/api/work-tracker")
    base = base.rstrip("/")
    if base.endswith("/work-tracker"):
        base = base[: -len("/work-tracker")]
    return base


def request_json(method: str, url: str) -> dict:
    headers = {"Accept": "application/json"}
    api_key = os.getenv("WORKTRACKER_API_KEY")
    if api_key:
        headers["x-api-key"] = api_key
    data = None
    if method == "POST":
        headers["Content-Type"] = "application/json"
        data = b"{}"
    request = Request(url, method=method, headers=headers, data=data)
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def emit(event: str, **fields: object) -> None:
    payload = {
        "at": datetime.now(timezone.utc).isoformat(),
        "event": event,
        **fields,
    }
    print(json.dumps(payload, sort_keys=True), flush=True)


def snapshot(graph: dict) -> dict[str, tuple[str, tuple[str, ...]]]:
    return {
        node["id"]: (node["state"], tuple(sorted(node.get("blocked_by", []))))
        for node in graph.get("nodes", [])
    }


def ready_nodes(graph: dict, root_id: str) -> set[str]:
    nodes = {node["id"]: node for node in graph.get("nodes", [])}
    ready = set()
    for node_id, node in nodes.items():
        if node_id == root_id or node.get("state") in FINISHED_STATES:
            continue
        blockers = node.get("blocked_by", [])
        if all(nodes.get(blocker, {}).get("state") in UNBLOCKING_STATES for blocker in blockers):
            ready.add(node_id)
    return ready


def changed_nodes(
    previous: dict[str, tuple[str, tuple[str, ...]]] | None,
    current: dict[str, tuple[str, tuple[str, ...]]],
) -> dict[str, object]:
    if previous is None:
        return {node_id: {"state": state, "blocked_by": blockers} for node_id, (state, blockers) in current.items()}
    changes: dict[str, object] = {}
    for node_id in sorted(previous.keys() | current.keys()):
        before = previous.get(node_id)
        after = current.get(node_id)
        if before != after:
            changes[node_id] = {"from": before, "to": after}
    return changes


def poll(root_id: str, interval: int) -> int:
    root = api_root()
    graph_url = f"{root}/work-items/{root_id}/dependency-graph"
    execute_url = f"{root}/work-items/{root_id}/execute-graph"
    previous_snapshot = None
    previous_ready: set[str] = set()
    previous_error = None

    while True:
        try:
            graph = request_json("GET", graph_url)
            current_snapshot = snapshot(graph)
            if current_snapshot != previous_snapshot:
                emit("graph_changed", changes=changed_nodes(previous_snapshot, current_snapshot))
            previous_snapshot = current_snapshot
            previous_error = None

            root_state = current_snapshot.get(root_id, (None, ()))[0]
            if root_state in ROOT_EXIT_STATES:
                emit("root_terminal", root_id=root_id, state=root_state)
                return 0

            current_ready = ready_nodes(graph, root_id)
            newly_ready = current_ready - previous_ready
            if newly_ready:
                result = request_json("POST", execute_url)
                statuses = {
                    node.get("task_id"): node.get("status")
                    for node in result.get("nodes", [])
                    if node.get("task_id") in newly_ready
                }
                emit("execute_graph", newly_ready=sorted(newly_ready), statuses=statuses)
            previous_ready = current_ready
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
            error = f"{type(exc).__name__}: {exc}"
            if error != previous_error:
                emit("poll_error", error=error)
                previous_error = error

        time.sleep(interval)


def daemonize(log_path: Path, pid_path: Path) -> bool:
    child_pid = os.fork()
    if child_pid:
        print(child_pid)
        return False

    os.setsid()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    null = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null, sys.stdin.fileno())
    os.dup2(log, sys.stdout.fileno())
    os.dup2(log, sys.stderr.fileno())
    os.close(null)
    os.close(log)
    pid_path.write_text(f"{os.getpid()}\n", encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--interval", type=int, default=45)
    parser.add_argument("--detach", action="store_true")
    parser.add_argument("--log", type=Path)
    parser.add_argument("--pid-file", type=Path)
    args = parser.parse_args()

    if args.detach:
        if args.log is None or args.pid_file is None:
            parser.error("--detach requires --log and --pid-file")
        if not daemonize(args.log, args.pid_file):
            return 0

    return poll(args.root, args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
