import { queryClient } from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { bindAgentOSApi } from './api'
import { MissionPlanReview } from './plan-review'
import type { AgentOSMissionJob, AgentOSPlanReview } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { AGENT_OS_LOCALES } = await import('./i18n')

  return {
    ...(await import('@tanstack/react-query')),
    ...(await import('@/components/ui/button')),
    ...(await import('@/components/ui/input')),
    ...(await import('@/components/ui/textarea')),
    ...(await import('@/lib/query-client')),
    captureGatewayFileDownload: () => vi.fn(),
    usePluginI18n: () => (key: keyof typeof AGENT_OS_LOCALES.en) => AGENT_OS_LOCALES.en[key]
  }
})

const job: AgentOSMissionJob = {
  id: 'job',
  goal: 'Write reviewed notes',
  state: 'WAITING_PLAN',
  created_at: '2026-10-19T00:00:00Z',
  updated_at: '2026-10-19T00:00:00Z'
}

function fixture() {
  let plan: AgentOSPlanReview = {
    job_id: job.id,
    task_id: 'task',
    plan_id: 'plan-1',
    revision: 1,
    objective: job.goal,
    workspace_id: null,
    state: 'DRAFT',
    reviewable: true,
    steps: [
      { id: 'write', title: 'Write notes', kind: 'ACTION', priority: 0, spec: { content: 'Before' }, depends_on: [] },
      { id: 'manual', title: 'Review manually', kind: 'MANUAL', priority: 0, spec: {}, depends_on: ['write'] }
    ]
  }

  const writes = vi.fn()
  let rejectSave = false

  const dispose = bindAgentOSApi(
    async <T,>(path: string, options?: { body?: unknown }) => {
      if (path.endsWith('/plan/edit')) {
        writes(options?.body)

        if (rejectSave) {
          throw new Error('Connection lost after save')
        }

        const body = options?.body as { steps: AgentOSPlanReview['steps'] }
        plan = {
          ...plan,
          revision: plan.revision + 1,
          plan_id: 'plan-2',
          steps: plan.steps.map(step => ({ ...step, ...body.steps.find(edit => edit.id === step.id) }))
        }

        return {} as T
      }

      if (path.endsWith('/plan')) {
        return plan as T
      }

      throw new Error(`Unexpected request: ${path}`)
    },
    () => () => undefined
  )

  return {
    dispose,
    writes,
    failSave: () => {
      rejectSave = true
    }
  }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
})

it('lets users correct JSON without losing edits and reviews only the saved new revision', async () => {
  const { dispose, writes } = fixture()

  try {
    render(
      <QueryClientProvider client={queryClient}>
        <MissionPlanReview job={job} onResolved={vi.fn()} />
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
    await screen.findByText('Version: 1')
    fireEvent.click(screen.getByRole('button', { name: 'Edit steps' }))
    const details = screen.getByRole('textbox', { name: 'Action details: Write notes' })
    fireEvent.change(details, { target: { value: '{broken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
    await screen.findByRole('alert')
    expect(writes).not.toHaveBeenCalled()
    fireEvent.change(details, { target: { value: '{"content":"After"}' } })
    expect(screen.getByRole('button', { name: 'Save new version' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Action details: Review manually' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    await screen.findByText('Version: 2')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve and start' }).hasAttribute('disabled')).toBe(false)
  } finally {
    dispose()
  }
})

it('requires an explicit reload after an uncertain server save instead of allowing approval', async () => {
  const { dispose, writes, failSave } = fixture()
  failSave()

  try {
    render(
      <QueryClientProvider client={queryClient}>
        <MissionPlanReview job={job} onResolved={vi.fn()} />
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
    await screen.findByText('Version: 1')
    fireEvent.click(screen.getByRole('button', { name: 'Edit steps' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
    await screen.findByRole('alert')
    expect(writes).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }))
    expect(screen.getByRole('button', { name: 'Approve and start' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reload plan' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: 'Approve and start' }).hasAttribute('disabled')).toBe(false)
  } finally {
    dispose()
  }
})
