import type { PluginRestOptions } from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { registerPluginLocales } from '@/i18n/plugin-i18n'

import { bindAgentOSApi } from '../plugins/agent-os/api'
import { AGENT_OS_LOCALES } from '../plugins/agent-os/i18n'
import { MissionPlanReview } from '../plugins/agent-os/plan-review'
import { MissionResults } from '../plugins/agent-os/results'
import type { AgentOSMissionJob, AgentOSPlanReview } from '../plugins/agent-os/types'

const job: AgentOSMissionJob = {
  id: 'mission / review', goal: 'Prepare a result', state: 'WAITING_PLAN',
  created_at: '', updated_at: ''
}

const plan: AgentOSPlanReview = {
  job_id: job.id, task_id: 'task-1', plan_id: 'plan-1', revision: 1,
  objective: 'Verify the result before declaring success', workspace_id: '/project',
  state: 'DRAFT', reviewable: true,
  steps: [
    { id: 'work', title: 'Read local result', kind: 'ACTION', priority: 0,
      spec: { tool: 'file', operation: 'read_file', input: { path: 'result.txt' } }, depends_on: [] },
    { id: 'verify', title: 'Check the outcome', kind: 'VERIFICATION', priority: 0,
      spec: { expected_state: { exists: true } }, depends_on: ['work'] }
  ]
}

let client: QueryClient
let dispose: () => void
let disposeLocales: () => void

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  disposeLocales = registerPluginLocales('agent-os', AGENT_OS_LOCALES)
})
afterEach(() => {
  cleanup()
  dispose?.()
  disposeLocales()
  client.clear()
})

it('requires a fresh explicit decision on the displayed version after a stale rejection', async () => {
  let currentPlan = plan
  const decisions: unknown[] = []

  const rest = async <T,>(path: string, options?: PluginRestOptions): Promise<T> => {
    if (!options) {return structuredClone(currentPlan) as T}
    expect(path).toBe('/missions/mission%20%2F%20review/plan/decision')
    decisions.push(options.body)

    if (decisions.length === 1) {throw new Error('Plan changed')}

    return { ok: true, job: { ...job, state: 'RUNNING' } } as T
  }

  dispose = bindAgentOSApi(rest, () => () => undefined)
  const onResolved = vi.fn()
  render(<QueryClientProvider client={client}><MissionPlanReview job={job} onResolved={onResolved} /></QueryClientProvider>)

  expect(decisions).toEqual([])
  expect(screen.queryByRole('button', { name: 'Approve and start' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
  await screen.findByText(plan.objective)
  expect(screen.getByText('Requires: Read local result')).toBeTruthy()
  expect(decisions).toEqual([])

  fireEvent.click(screen.getByRole('button', { name: 'Approve and start' }))
  await screen.findByText('Plan changed')
  expect(decisions).toEqual([{ plan_id: plan.plan_id, revision: plan.revision, choice: 'approve' }])
  expect(onResolved).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Approve and start' }) as HTMLButtonElement).disabled).toBe(true)

  currentPlan = { ...plan, plan_id: 'replacement', revision: 2, objective: 'Review a changed outcome' }
  fireEvent.click(screen.getByRole('button', { name: 'Reload plan' }))
  await screen.findByText(currentPlan.objective)
  await waitFor(() => expect((screen.getByRole('button', { name: 'Approve and start' }) as HTMLButtonElement).disabled).toBe(false))
  expect(decisions).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Approve and start' }))
  await waitFor(() => expect(onResolved).toHaveBeenCalledOnce())
  expect(decisions[1]).toEqual({ plan_id: currentPlan.plan_id, revision: currentPlan.revision, choice: 'approve' })
  expect((screen.getByRole('button', { name: 'Approve and start' }) as HTMLButtonElement).disabled).toBe(true)
})

it('allows discard while starting is blocked and rejects an incomplete review response', async () => {
  const decisions: unknown[] = []
  let failRead = true
  let finishDecision: (value: unknown) => void = () => undefined

  const rest = async <T,>(_path: string, options?: PluginRestOptions): Promise<T> => {
    if (!options) {
      if (failRead) {return { job_id: job.id, reviewable: true } as T}

      return structuredClone(plan) as T
    }

    decisions.push(options.body)

    return new Promise(resolve => {finishDecision = value => resolve(value as T)})
  }

  dispose = bindAgentOSApi(rest, () => () => undefined)
  const onResolved = vi.fn()
  render(<QueryClientProvider client={client}><MissionPlanReview job={job} onResolved={onResolved} startBlocked="New work paused" /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
  await screen.findByText('Could not load the plan.')
  expect((screen.getByRole('button', { name: 'Discard plan' }) as HTMLButtonElement).disabled).toBe(true)
  failRead = false
  fireEvent.click(screen.getByRole('button', { name: 'Reload plan' }))
  await screen.findByText(plan.objective)
  expect((screen.getByRole('button', { name: 'Approve and start' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Discard plan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Discard plan' }))
  expect(decisions).toEqual([{ plan_id: plan.plan_id, revision: plan.revision, choice: 'discard' }])
  expect(onResolved).not.toHaveBeenCalled()
  await act(async () => finishDecision({ ok: true, job: { ...job, state: 'CANCELLED' } }))
  expect(onResolved).toHaveBeenCalledOnce()
})

it('saves edited steps as a new draft and requires a separate explicit approval', async () => {
  let current = structuredClone(plan)
  const writes: { path: string; body: unknown }[] = []
  dispose = bindAgentOSApi(async <T,>(path: string, options?: PluginRestOptions): Promise<T> => {
    if (!options) {return structuredClone(current) as T}
    writes.push({ path, body: options.body })

    if (path.endsWith('/edit')) {
      const body = options.body as { steps: typeof plan.steps }
      current = { ...current, plan_id: 'edited-plan', revision: 2,
        steps: current.steps.map((step, index) => ({ ...step, title: body.steps[index].title })) }

      return structuredClone(current) as T
    }

    return { ok: true, job: { ...job, state: 'RUNNING' } } as T
  }, () => () => undefined)
  const onResolved = vi.fn()
  render(<QueryClientProvider client={client}><MissionPlanReview job={job} onResolved={onResolved} /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
  await screen.findByText(plan.objective)
  fireEvent.click(screen.getByRole('button', { name: 'Edit steps' }))
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Step title' })[0], { target: { value: 'Read the corrected result' } })
  expect((screen.getByRole('button', { name: 'Approve and start' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
  await screen.findByText('Read the corrected result')
  expect(writes).toHaveLength(1)
  expect(onResolved).not.toHaveBeenCalled()
  expect(writes[0].body).toMatchObject({ plan_id: plan.plan_id, revision: 1 })
  fireEvent.click(screen.getByRole('button', { name: 'Approve and start' }))
  await waitFor(() => expect(onResolved).toHaveBeenCalledOnce())
  expect(writes[1].body).toEqual({ plan_id: 'edited-plan', revision: 2, choice: 'approve' })
})


it('loads task-owned files on demand and renders verified preview as inert text', async () => {
  const calls: string[] = []

  const result = { id: 'action-1', task_id: 'task-1', name: 'result.txt', path: '/workspace/result.txt',
    sha256: 'saved-proof', bytes: 25, verified_at: '2026-10-04T10:00:00Z' }

  dispose = bindAgentOSApi(async <T,>(path: string): Promise<T> => {
    calls.push(path)

    return (path.endsWith('/action-1')
      ? { ...result, preview: '<img src=x onerror=alert(1)>', truncated: false }
      : { task_id: 'task-1', results: [result] }) as T
  }, () => () => undefined)
  render(<QueryClientProvider client={client}><MissionResults taskId="task-1" /></QueryClientProvider>)
  expect(calls).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Result files' }))
  await screen.findByText('result.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByText('<img src=x onerror=alert(1)>')
  expect(screen.queryByRole('img')).toBeNull()
  expect(calls).toEqual(['/tasks/task-1/results', '/tasks/task-1/results/action-1'])
})
