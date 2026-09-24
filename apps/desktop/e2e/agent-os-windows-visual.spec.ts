import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { expect, test } from './test'
import { setupMockBackend, waitForAppReady, type MockBackendFixture, type Sandbox } from './fixtures'

const scale = Number(process.env.AGENT_OS_VISUAL_SCALE ?? '1')
const scaleLabel = String(Math.round(scale * 100))

let fixture: MockBackendFixture | null = null

function seedAgentOS(sandbox: Sandbox): void {
  const script = String.raw`
from agent_os.agents.records import AgentInstanceRecord, AgentInstanceState
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.events import EventRecord, EventType
from agent_os.orchestration.plan import PlanRecord, PlanState, PlanStepKind, PlanStepRecord, PlanStepState
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore

store = AgentOSStore()
store.initialize()

task = store.create_task(TaskRecord.create(
    "Ship Agent OS V1 with security, visual QA, and Windows release evidence",
    session_id="visual-session",
    workspace_id="visual-workspace",
    metadata={"owner": "desktop", "phase": "visual-qa"},
))
for state in (TaskState.PLANNING, TaskState.READY, TaskState.RUNNING):
    store.transition_task(task.id, state)

plan = PlanRecord.create(task_id=task.id, objective="Qualify the Agent OS control center on Windows")
steps = [
    PlanStepRecord.create(plan_id=plan.id, task_id=task.id, title="Build desktop", kind=PlanStepKind.ACTION, priority=40),
    PlanStepRecord.create(plan_id=plan.id, task_id=task.id, title="Run security gates", kind=PlanStepKind.ACTION, priority=30),
    PlanStepRecord.create(plan_id=plan.id, task_id=task.id, title="Render Mission Control", kind=PlanStepKind.ACTION, priority=20),
    PlanStepRecord.create(plan_id=plan.id, task_id=task.id, title="Verify Windows UX", kind=PlanStepKind.VERIFICATION, priority=10),
]
store.create_plan(plan, steps, {steps[3].id: [steps[0].id, steps[1].id, steps[2].id]})
store.transition_plan(plan.id, PlanState.ACTIVE)
for step in steps[:3]:
    store.transition_plan_step(step.id, PlanStepState.READY)
store.transition_plan_step(steps[0].id, PlanStepState.RUNNING)
store.transition_plan_step(steps[0].id, PlanStepState.SUCCEEDED)
store.refresh_plan_readiness(plan.id)

for tool, operation, risk in [
    ("terminal", "npm run build", "L1_LOW"),
    ("browser", "verify release page", "L1_LOW"),
    ("computer_use", "inspect Windows UI", "L2_CONTROLLED"),
]:
    action = store.create_action(ActionRecord.create(
        task.id,
        tool=tool,
        operation=operation,
        verification_method="visual.qa",
        retry_budget=1,
    ))
    store.set_action_controls(action.id, risk_level=risk, permission_policy="explicit")
    store.start_action_execution(action.id)
    store.transition_action(action.id, ActionState.OBSERVING, actual_state={"status": "running"})
    store.transition_action(action.id, ActionState.VERIFYING)

for goal, role in [
    ("Inspect build output", "builder"),
    ("Review security posture", "security"),
    ("Validate Windows Mission Control", "visual-qa"),
]:
    agent = store.create_agent(AgentInstanceRecord.create(
        task_id=task.id,
        runtime="hermes-subagent",
        goal=goal,
        role=role,
    ))
    store.transition_agent(agent.id, AgentInstanceState.STARTING)
    store.transition_agent(agent.id, AgentInstanceState.RUNNING)

store.append_event(EventRecord.create(
    task_id=task.id,
    type=EventType.APPROVAL_REQUESTED,
    payload={"reason": "controlled Windows interaction"},
))
`

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  execFileSync('uv', ['run', '--python', '3.11', 'python', '-c', script], {
    cwd: repoRoot,
    env: { ...process.env, HERMES_HOME: sandbox.hermesHome },
    stdio: 'inherit',
  })
}

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    launchArgs: [`--force-device-scale-factor=${scale}`],
    prepareSandbox: seedAgentOS,
  })
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

async function gotoMissionControl(): Promise<void> {
  const { page } = fixture!
  await page.evaluate(() => {
    window.location.hash = '#/agent-os'
  })
  await expect(page.locator('.agent-os-page')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible()
}

test(`Mission Control renders without clipping at ${scaleLabel}% DPI`, async () => {
  const { page, app } = fixture!

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setSize(1220, 800, false)
  })

  await gotoMissionControl()

  const root = page.locator('.agent-os-page')

  const nav = page.getByRole('navigation', { name: 'Agent OS sections' })
  await expect(nav).toBeVisible()

  const metrics = await root.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))

  expect(metrics.clientWidth).toBeGreaterThan(600)
  expect(metrics.clientHeight).toBeGreaterThan(400)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 2)

  await page.getByRole('button', { name: 'Tasks', exact: true }).focus()
  const focusStyle = await page.getByRole('button', { name: 'Tasks', exact: true }).evaluate(element => {
    const style = getComputedStyle(element)
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
  })
  expect(focusStyle.outlineStyle).not.toBe('none')
  const physicalOutlineWidth = Number.parseFloat(focusStyle.outlineWidth) * scale
  expect(physicalOutlineWidth).toBeGreaterThanOrEqual(1.99)

  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: test.info().outputPath(`agent-os-windows-${scaleLabel}-actual.png`),
  })
})

test(`Mission Control navigation remains operable at ${scaleLabel}% DPI`, async () => {
  const { page } = fixture!
  await gotoMissionControl()
  const sections = ['Tasks', 'Operations', 'Projects', 'Fleet', 'Memory', 'Connections', 'Security']

  for (const section of sections) {
    const button = page.getByRole('button', { name: section, exact: true })
    await button.scrollIntoViewIfNeeded()
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
  }

  const nav = page.getByRole('navigation', { name: 'Agent OS sections' })
  const overflow = await nav.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }))
  expect(['auto', 'scroll']).toContain(overflow.overflowX)
  expect(overflow.scrollWidth).toBeGreaterThanOrEqual(overflow.clientWidth)
})
