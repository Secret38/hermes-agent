"""Network-independent local integration Golden Task handlers."""

from __future__ import annotations

import os
import shlex
import socket
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from agent_os.adapters.hermes_file import HermesFileExecutor
from agent_os.adapters.hermes_terminal import (
    HermesProcessController,
    HermesTerminalExecutor,
    TerminalResultVerifier,
)
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.kernel import AgentOSKernel
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.states import ActionState
from agent_os.store import AgentOSStore
from agent_os.verification.gate import VerificationResult, VerificationVerdict

from .golden import GoldenTaskDefinition, GoldenTaskOutcome, GoldenTaskResult


class _WorkspacePermissionGate:
    """Allow local disposable-workspace actions up to L2, deny L3/L4."""

    def __init__(self, root: Path):
        self.root = root.resolve()

    def authorize(
        self,
        action: ActionRecord,
        risk: RiskAssessment,
    ) -> PermissionDecision:
        workspace = Path(action.workspace_id or self.root).resolve()
        try:
            workspace.relative_to(self.root)
            inside = True
        except ValueError:
            inside = False

        allowed = inside and risk.level in {
            RiskLevel.L0_OBSERVE,
            RiskLevel.L1_REVERSIBLE,
            RiskLevel.L2_PERSISTENT_LOCAL,
        }
        return PermissionDecision(
            PermissionOutcome.ALLOW if allowed else PermissionOutcome.DENY,
            decided_by=type(self).__name__,
            reason=(
                f"{risk.level.value} inside disposable benchmark workspace"
                if allowed
                else "benchmark policy denies external/sensitive or out-of-workspace action"
            ),
        )


class _HostFileExactVerifier:
    def verify(
        self,
        action: ActionRecord,
        actual_state: dict[str, Any],
    ) -> VerificationResult:
        path = Path(str(action.input.get("path") or ""))
        expected = str(action.input.get("content") or "")
        try:
            observed = path.read_text(encoding="utf-8")
        except Exception as exc:
            return VerificationResult(
                VerificationVerdict.FAILED,
                "golden.host-file-exact",
                reason=f"{type(exc).__name__}: {exc}",
            )
        passed = observed == expected
        return VerificationResult(
            VerificationVerdict.PASSED if passed else VerificationVerdict.FAILED,
            "golden.host-file-exact",
            evidence={
                "path": str(path),
                "bytes": len(observed.encode("utf-8")),
                "matches": passed,
            },
            reason="" if passed else "file contents do not match requested content",
        )


def _shell(args: list[str]) -> str:
    if os.name == "nt":
        return subprocess.list2cmdline(args)
    return shlex.join(args)


def _store(root: Path) -> AgentOSStore:
    return AgentOSStore(root / "agent_os.db")


def _terminal_action(
    store: AgentOSStore,
    task_id: str,
    root: Path,
    *,
    command: str,
    operation: str,
    expected: dict[str, Any],
    background: bool = False,
    timeout: int = 120,
) -> ActionRecord:
    action = store.create_action(
        ActionRecord.create(
            task_id,
            tool="terminal",
            operation=operation,
            input={
                "command": command,
                "workdir": str(root),
                "background": background,
            },
            expected_state=expected,
            workspace_id=str(root),
            timeout_seconds=timeout,
            verification_required=True,
        )
    )
    return AgentOSKernel(
        store,
        executor=HermesTerminalExecutor(host_local=True),
        verifier=TerminalResultVerifier(),
        permission_gate=_WorkspacePermissionGate(root),
    ).execute_action(action.id)


def repository_clone(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt02-") as temp:
        root = Path(temp)
        source = root / "source"
        target = root / "clone"
        source.mkdir()
        (source / "README.md").write_text("agent-os-clone-fixture\n", encoding="utf-8")

        try:
            subprocess.run(["git", "init"], cwd=source, check=True, capture_output=True)
            subprocess.run(
                ["git", "config", "user.email", "agent-os@example.invalid"],
                cwd=source, check=True, capture_output=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Agent OS Golden"],
                cwd=source, check=True, capture_output=True,
            )
            subprocess.run(["git", "add", "."], cwd=source, check=True, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", "fixture"],
                cwd=source, check=True, capture_output=True,
            )
        except (FileNotFoundError, subprocess.CalledProcessError) as exc:
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.BLOCKED,
                verified=False,
                error=f"git fixture unavailable: {type(exc).__name__}",
            )

        store = _store(root)
        task = store.create_task(TaskRecord.create(definition.goal))
        command = _shell(["git", "clone", str(source), str(target)])
        result = _terminal_action(
            store,
            task.id,
            root,
            command=command,
            operation="clone local repository",
            expected={"exit_code": 0},
        )
        verified = (
            result.state is ActionState.SUCCEEDED
            and (target / ".git").is_dir()
            and (target / "README.md").read_text(encoding="utf-8")
            == "agent-os-clone-fixture\n"
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "action_state": result.state.value,
                "git_dir": (target / ".git").is_dir(),
                "readme_present": (target / "README.md").is_file(),
            },
            error=None if verified else "repository clone was not verifiably complete",
        )


def dependency_install(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt03-") as temp:
        root = Path(temp)
        package = root / "package"
        vendor = root / "vendor"
        module = package / "demo_pkg"
        module.mkdir(parents=True)
        vendor.mkdir()
        (module / "__init__.py").write_text("VALUE = 42\n", encoding="utf-8")
        (package / "setup.py").write_text(
            "from setuptools import setup\n"
            "setup(name='agent-os-demo-pkg', version='0.0.1', packages=['demo_pkg'])\n",
            encoding="utf-8",
        )

        store = _store(root)
        task = store.create_task(TaskRecord.create(definition.goal))
        install_command = _shell([
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-deps",
            "--no-build-isolation",
            "--target",
            str(vendor),
            str(package),
        ])
        installed = _terminal_action(
            store,
            task.id,
            root,
            command=install_command,
            operation="install local dependency",
            expected={"exit_code": 0},
            timeout=180,
        )

        verify_code = (
            "import sys;"
            f"sys.path.insert(0,{str(vendor)!r});"
            "import demo_pkg;"
            "print(demo_pkg.VALUE)"
        )
        verified_import = _terminal_action(
            store,
            task.id,
            root,
            command=_shell([sys.executable, "-c", verify_code]),
            operation="inspect installed dependency",
            expected={"exit_code": 0, "output_contains": "42"},
        )
        verified = (
            installed.state is ActionState.SUCCEEDED
            and verified_import.state is ActionState.SUCCEEDED
            and (vendor / "demo_pkg" / "__init__.py").is_file()
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "install_state": installed.state.value,
                "import_state": verified_import.state.value,
                "installed_module": (vendor / "demo_pkg" / "__init__.py").is_file(),
            },
            error=None if verified else "local dependency installation was not reproducible",
        )


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def project_start(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt04-") as temp:
        root = Path(temp)
        marker = "AGENT_OS_READY_GT04"
        (root / "index.html").write_text(marker, encoding="utf-8")
        port = _free_port()
        store = _store(root)
        task = store.create_task(TaskRecord.create(definition.goal))
        process = HermesProcessController()
        session_id = None
        cleanup_result: dict[str, Any] = {}

        try:
            start = _terminal_action(
                store,
                task.id,
                root,
                command=_shell([
                    sys.executable,
                    "-m",
                    "http.server",
                    str(port),
                    "--bind",
                    "127.0.0.1",
                ]),
                operation="start local project server",
                expected={"exit_code": 0, "session_id_present": True},
                background=True,
            )
            session_id = str(start.actual_state.get("session_id") or "")
            if start.state is not ActionState.SUCCEEDED or not session_id:
                raise RuntimeError("background server did not start")

            probe_code = (
                "import sys,time,urllib.request;"
                f"url='http://127.0.0.1:{port}/';"
                "last=None;"
                "\nfor _ in range(50):"
                "\n try:"
                "\n  data=urllib.request.urlopen(url,timeout=1).read().decode();print(data);sys.exit(0)"
                "\n except Exception as exc:"
                "\n  last=exc;time.sleep(0.1)"
                "\nraise SystemExit(f'not ready: {last}')"
            )
            probe = _terminal_action(
                store,
                task.id,
                root,
                command=_shell([sys.executable, "-c", probe_code]),
                operation="inspect local project readiness",
                expected={"exit_code": 0, "output_contains": marker},
                timeout=30,
            )
            verified = (
                start.state is ActionState.SUCCEEDED
                and probe.state is ActionState.SUCCEEDED
                and marker in str(probe.actual_state.get("output") or "")
            )
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
                verified=verified,
                evidence={
                    "start_state": start.state.value,
                    "probe_state": probe.state.value,
                    "session_id_present": bool(session_id),
                    "port": port,
                },
                error=None if verified else "started project never reached verified readiness",
            )
        finally:
            if session_id:
                cleanup_result = process.kill(session_id)


def file_mutation(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt14-") as temp:
        root = Path(temp)
        path = root / "artifact.txt"
        store = _store(root)
        task = store.create_task(TaskRecord.create(definition.goal))
        gate = _WorkspacePermissionGate(root)

        states = []
        for content in ("version-one\n", "version-two\n"):
            action = store.create_action(
                ActionRecord.create(
                    task.id,
                    tool="file",
                    operation="write_file",
                    input={"path": str(path), "content": content},
                    expected_state={"content": content},
                    workspace_id=str(root),
                    verification_required=True,
                )
            )
            result = AgentOSKernel(
                store,
                executor=HermesFileExecutor(),
                verifier=_HostFileExactVerifier(),
                permission_gate=gate,
            ).execute_action(action.id)
            states.append(result.state)

        verified = (
            states == [ActionState.SUCCEEDED, ActionState.SUCCEEDED]
            and path.read_text(encoding="utf-8") == "version-two\n"
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "states": [state.value for state in states],
                "final_content": path.read_text(encoding="utf-8") if path.exists() else None,
            },
            error=None if verified else "file create/modify result did not match requested state",
        )


def integration_handlers():
    return {
        "repository_clone": repository_clone,
        "dependency_install": dependency_install,
        "project_start": project_start,
        "file_mutation": file_mutation,
    }
