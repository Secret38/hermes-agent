"""Read-only projection for the Agent OS Mission Control UI.

The execution store remains the source of truth. This module deliberately opens
agent_os.db in SQLite read-only/query-only mode so merely viewing Mission
Control can never migrate, repair, or mutate execution state.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .health import AgentOSHealthReport, collect_agent_os_health
from .store import default_db_path

_SECRET_KEY_RE = re.compile(
    r"(secret|token|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key)",
    re.IGNORECASE,
)
_MAX_STRING = 800
_MAX_COLLECTION = 80
_MAX_DEPTH = 5


def _json_loads(raw: Any) -> Any:
    if not raw:
        return {}
    try:
        return json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _safe_value(value: Any, *, depth: int = 0) -> Any:
    """Return a bounded, secret-redacted JSON-safe value for UI evidence."""

    if depth >= _MAX_DEPTH:
        return "[truncated]"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in list(value.items())[:_MAX_COLLECTION]:
            name = str(key)
            out[name] = "[redacted]" if _SECRET_KEY_RE.search(name) else _safe_value(item, depth=depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [_safe_value(item, depth=depth + 1) for item in list(value)[:_MAX_COLLECTION]]
    if isinstance(value, str):
        return value if len(value) <= _MAX_STRING else value[:_MAX_STRING] + "…"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:_MAX_STRING]


def _row_dict(row: sqlite3.Row, *, json_fields: tuple[str, ...] = ()) -> dict[str, Any]:
    out = dict(row)
    for field in json_fields:
        if field in out:
            out[field.removesuffix("_json")] = _safe_value(_json_loads(out.pop(field)))
    return out


def _open_readonly(path: Path) -> sqlite3.Connection:
    uri = path.resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def _health_dict(report: AgentOSHealthReport | dict[str, Any] | None, path: Path) -> dict[str, Any]:
    if report is None:
        return collect_agent_os_health(db_path=path, fix=False).to_dict()
    if isinstance(report, AgentOSHealthReport):
        return report.to_dict()
    return dict(report)


def _empty_snapshot(path: Path, health: dict[str, Any], *, store_error: str | None = None) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "store_path": str(path),
        "store_error": store_error,
        "health": health,
        "summary": {
            "tasks": 0,
            "active_tasks": 0,
            "completed_tasks": 0,
            "failed_tasks": 0,
            "actions": 0,
            "running_actions": 0,
            "agents": 0,
            "active_agents": 0,
            "events": 0,
            "recoveries": 0,
            "approvals": 0,
            "verifications": 0,
            "checkpoints": 0,
            "workspaces": 0,
        },
        "tasks": [],
        "topology": {"nodes": _topology_nodes(health, set(), set()), "edges": _topology_edges(health, set(), set())},
        "memory": {"workspaces": [], "sessions": [], "checkpoints": [], "event_types": [], "relations": []},
    }


def _topology_nodes(
    health: dict[str, Any],
    action_tools: set[str],
    agent_runtimes: set[str],
) -> list[dict[str, Any]]:
    checks = {str(c.get("name")): c for c in health.get("checks", []) if isinstance(c, dict)}
    full_ready = bool(health.get("full_ready"))
    nodes: list[dict[str, Any]] = [
        {
            "id": "agent-os",
            "kind": "core",
            "label": "Agent OS",
            "status": "READY" if full_ready else ("CORE READY" if health.get("core_ready") else "DEGRADED"),
            "detail": "Durable execution control plane",
        }
    ]

    for name, label in (
        ("runtime_core", "Runtime Core"),
        ("durable_store", "Durable Store"),
        ("browser", "Browser"),
        ("computer_use", "Computer Use"),
    ):
        check = checks.get(name)
        if not check:
            continue
        nodes.append(
            {
                "id": name,
                "kind": "capability",
                "label": label,
                "status": check.get("status", "UNKNOWN"),
                "detail": check.get("detail", ""),
                "remediation": check.get("remediation"),
            }
        )

    # Terminal/file are always part of the concrete Hermes Agent OS composition;
    # observed tools add any additional registered/used execution surfaces.
    tools = {"terminal", "file", *action_tools}
    for tool in sorted(tools):
        if tool in {"browser", "computer_use"}:
            continue
        nodes.append(
            {
                "id": f"tool:{tool}",
                "kind": "tool",
                "label": tool.replace("_", " ").title(),
                "status": "OBSERVED" if tool in action_tools else "AVAILABLE",
                "detail": "Hermes execution tool",
            }
        )

    for runtime in sorted(agent_runtimes):
        nodes.append(
            {
                "id": f"runtime:{runtime}",
                "kind": "agent_runtime",
                "label": runtime,
                "status": "OBSERVED",
                "detail": "Agent runtime",
            }
        )
    return nodes


def _topology_edges(
    health: dict[str, Any],
    action_tools: set[str],
    agent_runtimes: set[str],
) -> list[dict[str, str]]:
    nodes = _topology_nodes(health, action_tools, agent_runtimes)
    return [
        {"source": "agent-os", "target": node["id"], "relation": "uses"}
        for node in nodes
        if node["id"] != "agent-os"
    ]


def dashboard_event_sequence(*, db_path: Path | str | None = None) -> int:
    """Return the current append-only event sequence without mutating the store."""

    path = Path(db_path) if db_path is not None else default_db_path()
    if not path.exists():
        return 0
    try:
        conn = _open_readonly(path)
    except Exception:
        return 0
    try:
        row = conn.execute("SELECT COALESCE(MAX(sequence), 0) FROM events").fetchone()
        return int(row[0] if row is not None else 0)
    except sqlite3.DatabaseError:
        return 0
    finally:
        conn.close()


def build_dashboard_snapshot(
    *,
    limit: int = 40,
    db_path: Path | str | None = None,
    health_report: AgentOSHealthReport | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project durable Agent OS state into a bounded read model for Desktop."""

    limit = max(1, min(int(limit), 100))
    path = Path(db_path) if db_path is not None else default_db_path()
    health = _health_dict(health_report, path)

    if not path.exists():
        return _empty_snapshot(path, health)

    try:
        conn = _open_readonly(path)
    except Exception as exc:
        return _empty_snapshot(path, health, store_error=f"{type(exc).__name__}: {exc}")

    try:
        task_rows = conn.execute(
            """SELECT id, goal, state, parent_task_id, session_id, kanban_task_id,
                      workspace_id, metadata_json, created_at, updated_at
                 FROM tasks
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?""",
            (limit,),
        ).fetchall()

        # Global counters intentionally use COUNT/GROUP BY rather than loading
        # unbounded history into the Desktop projection.
        task_counts = Counter(
            {row["state"]: int(row["n"]) for row in conn.execute("SELECT state, COUNT(*) n FROM tasks GROUP BY state")}
        )
        action_counts = Counter(
            {row["state"]: int(row["n"]) for row in conn.execute("SELECT state, COUNT(*) n FROM actions GROUP BY state")}
        )
        agent_counts = Counter(
            {row["state"]: int(row["n"]) for row in conn.execute("SELECT state, COUNT(*) n FROM agent_instances GROUP BY state")}
        )
        event_type_counts = Counter(
            {row["type"]: int(row["n"]) for row in conn.execute("SELECT type, COUNT(*) n FROM events GROUP BY type")}
        )
        total_events = sum(event_type_counts.values())

        if not task_rows:
            empty = _empty_snapshot(path, health)
            empty["summary"]["events"] = total_events
            empty["memory"]["event_types"] = [
                {"type": name, "count": count} for name, count in event_type_counts.most_common()
            ]
            return empty

        task_ids = [str(row["id"]) for row in task_rows]
        marks = ",".join("?" for _ in task_ids)

        plan_rows = conn.execute(
            f"""SELECT id, task_id, objective, revision, state, metadata_json, created_at, updated_at
                  FROM plans
                 WHERE task_id IN ({marks})
                 ORDER BY task_id, revision DESC, created_at DESC""",
            task_ids,
        ).fetchall()
        latest_plan_by_task: dict[str, sqlite3.Row] = {}
        for row in plan_rows:
            latest_plan_by_task.setdefault(str(row["task_id"]), row)

        plan_ids = [str(row["id"]) for row in latest_plan_by_task.values()]
        steps_by_plan: dict[str, list[dict[str, Any]]] = defaultdict(list)
        deps_by_plan: dict[str, list[dict[str, str]]] = defaultdict(list)
        if plan_ids:
            plan_marks = ",".join("?" for _ in plan_ids)
            for row in conn.execute(
                f"""SELECT id, plan_id, task_id, title, kind, state, spec_json,
                           execution_id, claim_owner, claim_expires_at, priority,
                           created_at, updated_at
                      FROM plan_steps
                     WHERE plan_id IN ({plan_marks})
                     ORDER BY plan_id, priority DESC, created_at, id""",
                plan_ids,
            ):
                steps_by_plan[str(row["plan_id"])].append(_row_dict(row, json_fields=("spec_json",)))

            for row in conn.execute(
                f"""SELECT s.plan_id, d.step_id, d.dependency_step_id
                      FROM plan_step_dependencies d
                      JOIN plan_steps s ON s.id = d.step_id
                     WHERE s.plan_id IN ({plan_marks})
                     ORDER BY s.plan_id, d.step_id, d.dependency_step_id""",
                plan_ids,
            ):
                deps_by_plan[str(row["plan_id"])].append(
                    {"step_id": str(row["step_id"]), "dependency_step_id": str(row["dependency_step_id"])}
                )

        actions_by_task: dict[str, list[dict[str, Any]]] = defaultdict(list)
        action_tools: set[str] = set()
        checkpoint_rows: list[dict[str, Any]] = []
        for row in conn.execute(
            f"""SELECT id, task_id, parent_action_id, agent_id, tool, operation, state,
                       risk_level, permission_policy, workspace_id, checkpoint_id,
                       retry_budget, verification_required, verification_method,
                       verification_result_json, recovery_attempts, execution_attempts,
                       error, created_at, updated_at
                  FROM actions
                 WHERE task_id IN ({marks})
                 ORDER BY created_at, id""",
            task_ids,
        ):
            item = _row_dict(row, json_fields=("verification_result_json",))
            action_tools.add(str(row["tool"]))
            actions_by_task[str(row["task_id"])].append(item)
            if row["checkpoint_id"]:
                checkpoint_rows.append(
                    {
                        "id": str(row["checkpoint_id"]),
                        "action_id": str(row["id"]),
                        "task_id": str(row["task_id"]),
                        "workspace_id": row["workspace_id"],
                        "updated_at": row["updated_at"],
                    }
                )

        agents_by_task: dict[str, list[dict[str, Any]]] = defaultdict(list)
        agent_runtimes: set[str] = set()
        for row in conn.execute(
            f"""SELECT id, task_id, runtime, goal, state, parent_agent_id, role,
                       restart_count, max_restarts, error, diagnostic,
                       created_at, updated_at, started_at, completed_at
                  FROM agent_instances
                 WHERE task_id IN ({marks})
                 ORDER BY created_at, id""",
            task_ids,
        ):
            item = dict(row)
            agent_runtimes.add(str(row["runtime"]))
            agents_by_task[str(row["task_id"])].append(item)

        events_by_task: dict[str, list[dict[str, Any]]] = defaultdict(list)
        # A bounded global tail keeps refresh cost predictable even after months
        # of autonomous operation. Each task is later capped again in the UI.
        for row in conn.execute(
            f"""SELECT sequence, id, task_id, action_id, type, payload_json, created_at
                  FROM events
                 WHERE task_id IN ({marks})
                 ORDER BY sequence DESC
                 LIMIT 1200""",
            task_ids,
        ):
            task_id = str(row["task_id"])
            if len(events_by_task[task_id]) >= 80:
                continue
            events_by_task[task_id].append(_row_dict(row, json_fields=("payload_json",)))
        for items in events_by_task.values():
            items.reverse()

        tasks: list[dict[str, Any]] = []
        workspace_map: dict[str, dict[str, Any]] = {}
        session_map: dict[str, dict[str, Any]] = {}
        relations: list[dict[str, str]] = []

        for row in task_rows:
            task = _row_dict(row, json_fields=("metadata_json",))
            task_id = str(row["id"])
            actions = actions_by_task.get(task_id, [])
            agents = agents_by_task.get(task_id, [])
            events = events_by_task.get(task_id, [])
            plan_row = latest_plan_by_task.get(task_id)
            plan: dict[str, Any] | None = None

            if plan_row is not None:
                plan_id = str(plan_row["id"])
                steps = steps_by_plan.get(plan_id, [])
                step_counts = Counter(str(step["state"]) for step in steps)
                plan = _row_dict(plan_row, json_fields=("metadata_json",))
                plan["steps"] = steps
                plan["dependencies"] = deps_by_plan.get(plan_id, [])
                plan["progress"] = {
                    "total": len(steps),
                    "succeeded": step_counts["SUCCEEDED"],
                    "running": step_counts["RUNNING"],
                    "ready": step_counts["READY"],
                    "blocked": step_counts["BLOCKED"],
                    "failed": step_counts["FAILED"],
                    "cancelled": step_counts["CANCELLED"],
                }

            event_counts = Counter(str(event["type"]) for event in events)
            task["plan"] = plan
            task["actions"] = actions
            task["agents"] = agents
            task["events"] = events
            task["metrics"] = {
                "actions": len(actions),
                "agents": len(agents),
                "recoveries": sum(int(action.get("recovery_attempts") or 0) for action in actions),
                "approvals": event_counts["approval.requested"],
                "verifications": event_counts["verification.recorded"],
                "checkpoints": sum(1 for action in actions if action.get("checkpoint_id")),
            }
            tasks.append(task)

            workspace_id = row["workspace_id"]
            if workspace_id:
                key = str(workspace_id)
                entry = workspace_map.setdefault(key, {"id": key, "tasks": 0, "active_tasks": 0})
                entry["tasks"] += 1
                if str(row["state"]) not in {"COMPLETED", "FAILED", "CANCELLED"}:
                    entry["active_tasks"] += 1
                relations.append({"source": f"workspace:{key}", "target": f"task:{task_id}", "relation": "contains"})

            session_id = row["session_id"]
            if session_id:
                key = str(session_id)
                entry = session_map.setdefault(key, {"id": key, "tasks": 0})
                entry["tasks"] += 1
                relations.append({"source": f"session:{key}", "target": f"task:{task_id}", "relation": "originated"})

        for checkpoint in checkpoint_rows:
            relations.append(
                {
                    "source": f"checkpoint:{checkpoint['id']}",
                    "target": f"action:{checkpoint['action_id']}",
                    "relation": "protects",
                }
            )

        active_task_states = {
            "CREATED", "INTERPRETING", "PLANNING", "READY", "RUNNING", "VERIFYING",
            "WAITING_FOR_APPROVAL", "WAITING_FOR_USER", "RECOVERING", "BLOCKED",
        }
        running_action_states = {"WAITING_PERMISSION", "EXECUTING", "OBSERVING", "VERIFYING", "RECOVERING", "BLOCKED"}
        active_agent_states = {"CREATED", "STARTING", "RUNNING", "CANCELLING", "ORPHANED"}

        summary = {
            "tasks": sum(task_counts.values()),
            "active_tasks": sum(task_counts[state] for state in active_task_states),
            "completed_tasks": task_counts["COMPLETED"],
            "failed_tasks": task_counts["FAILED"],
            "actions": sum(action_counts.values()),
            "running_actions": sum(action_counts[state] for state in running_action_states),
            "agents": sum(agent_counts.values()),
            "active_agents": sum(agent_counts[state] for state in active_agent_states),
            "events": total_events,
            "recoveries": event_type_counts["recovery.attempted"],
            "approvals": event_type_counts["approval.requested"],
            "verifications": event_type_counts["verification.recorded"],
            "checkpoints": event_type_counts["checkpoint.bound"],
            "workspaces": int(
                conn.execute("SELECT COUNT(DISTINCT workspace_id) FROM tasks WHERE workspace_id IS NOT NULL").fetchone()[0]
            ),
        }

        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "store_path": str(path),
            "store_error": None,
            "health": health,
            "summary": summary,
            "tasks": tasks,
            "topology": {
                "nodes": _topology_nodes(health, action_tools, agent_runtimes),
                "edges": _topology_edges(health, action_tools, agent_runtimes),
            },
            "memory": {
                "workspaces": sorted(workspace_map.values(), key=lambda item: item["id"]),
                "sessions": sorted(session_map.values(), key=lambda item: item["id"]),
                "checkpoints": checkpoint_rows[-100:],
                "event_types": [
                    {"type": name, "count": count} for name, count in event_type_counts.most_common()
                ],
                "relations": relations[-500:],
            },
        }
    except Exception as exc:
        return _empty_snapshot(path, health, store_error=f"{type(exc).__name__}: {exc}")
    finally:
        conn.close()
