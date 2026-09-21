"""Production composition for Agent OS on top of Hermes primitives."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from agent.subagent_lifecycle import SubagentLifecycleService

from .adapters.hermes_approval import HermesApprovalGate
from .adapters.hermes_browser import (
    HermesBrowserExecutor,
    HermesBrowserVerifier,
    browser_available,
)
from .adapters.hermes_checkpoint import HermesCheckpointProvider
from .adapters.hermes_computer import (
    HermesComputerUseExecutor,
    HermesComputerUseVerifier,
    computer_use_available,
)
from .adapters.hermes_file import HermesFileExecutor, HermesFileVerifier
from .adapters.hermes_planner import HermesPlanner
from .adapters.hermes_subagent import HermesSubagentRuntimeAdapter
from .adapters.hermes_terminal import HermesTerminalExecutor, TerminalResultVerifier
from .adapters.hermes_verifier import HermesProjectVerifier
from .capabilities import CapabilityCatalog
from .kernel import AgentOSKernel
from .permissions import PermissionGate
from .runtime import AgentOSRuntime
from .store import AgentOSStore
from .verification.router import VerifierRouter


def build_hermes_agent_os_runtime(
    store: AgentOSStore | None = None,
    *,
    planner=None,
    planner_kwargs: dict[str, Any] | None = None,
    approval_callback: Callable | None = None,
    approval_timeout_seconds: int | None = None,
    permission_gate: PermissionGate | None = None,
    subagent_service: SubagentLifecycleService | None = None,
    enable_browser: bool | None = None,
    enable_computer_use: bool | None = None,
    host_local_terminal: bool = False,
    scheduler_owner_id: str | None = None,
    scheduler_lease_seconds: float = 60.0,
    checkpoint_provider=None,
) -> AgentOSRuntime:
    """Build the concrete Agent OS runtime from existing Hermes subsystems.

    Planner capability constraints are derived from the exact kernels and
    runtime adapters assembled here, so planning and execution cannot drift.
    """

    store = store or AgentOSStore()
    approval_gate = permission_gate or HermesApprovalGate(
        approval_callback=approval_callback,
        timeout_seconds=approval_timeout_seconds,
    )
    checkpoints = checkpoint_provider or HermesCheckpointProvider()

    project_verifier = HermesProjectVerifier()
    terminal_verifier = VerifierRouter(
        TerminalResultVerifier(),
        methods={"hermes.project": project_verifier},
    )
    file_verifier = VerifierRouter(
        HermesFileVerifier(),
        methods={"hermes.project": project_verifier},
    )

    kernels = {
        "terminal": AgentOSKernel(
            store,
            executor=HermesTerminalExecutor(host_local=host_local_terminal),
            verifier=terminal_verifier,
            permission_gate=approval_gate,
            checkpoint_provider=checkpoints,
        ),
        "file": AgentOSKernel(
            store,
            executor=HermesFileExecutor(),
            verifier=file_verifier,
            permission_gate=approval_gate,
            checkpoint_provider=checkpoints,
        ),
    }

    browser_enabled = browser_available() if enable_browser is None else bool(enable_browser)
    if browser_enabled:
        kernels["browser"] = AgentOSKernel(
            store,
            executor=HermesBrowserExecutor(),
            verifier=HermesBrowserVerifier(),
            permission_gate=approval_gate,
            checkpoint_provider=None,
        )

    computer_enabled = (
        computer_use_available()
        if enable_computer_use is None
        else bool(enable_computer_use)
    )
    if computer_enabled:
        kernels["computer_use"] = AgentOSKernel(
            store,
            executor=HermesComputerUseExecutor(),
            verifier=HermesComputerUseVerifier(),
            permission_gate=approval_gate,
            checkpoint_provider=None,
        )

    runtime_adapters = (
        []
        if subagent_service is None
        else [HermesSubagentRuntimeAdapter(subagent_service)]
    )
    capabilities = CapabilityCatalog.from_execution(
        action_kernels=kernels,
        agent_runtime_adapters=runtime_adapters,
    )

    if planner is None:
        planner = HermesPlanner(
            capabilities,
            **dict(planner_kwargs or {}),
        )

    return AgentOSRuntime(
        store,
        planner=planner,
        action_kernels=kernels,
        agent_runtime_adapters=runtime_adapters,
        scheduler_owner_id=scheduler_owner_id,
        scheduler_lease_seconds=scheduler_lease_seconds,
    )
