import { queryClient } from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { bindAgentOSApi } from './api'
import { ResultsGallery } from './results-gallery'
import type { AgentOSTask } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { AGENT_OS_LOCALES } = await import('./i18n')

  return {
    ...(await import('@tanstack/react-query')),
    ...(await import('@/components/ui/button')),
    ...(await import('@/components/ui/search-field')),
    ...(await import('@/lib/query-client')),
    captureGatewayFileDownload: () => vi.fn(),
    usePluginI18n: () => (key: keyof typeof AGENT_OS_LOCALES.en) => AGENT_OS_LOCALES.en[key]
  }
})

function task(id: string): AgentOSTask {
  return {
    id, goal: `Mission ${id}`, state: 'COMPLETED', workspace_id: `workspace-${id}`,
    created_at: '2026-10-19T00:00:00Z', updated_at: '2026-10-19T00:00:00Z',
    actions: [], agents: [], events: [],
    metrics: { actions: 0, agents: 0, recoveries: 0, approvals: 0, verifications: 0, checkpoints: 0 }
  }
}

function file(id: string) {
  return { id: `file-${id}`, task_id: id, name: `notes-${id}.txt`, path: `/work/${id}.txt`,
    sha256: 'a'.repeat(64), bytes: 5, verified_at: '2026-10-19T00:00:00Z' }
}

function Gallery() {
  const [selectedId, setSelectedId] = useState('A')

  return <QueryClientProvider client={queryClient}>
    <ResultsGallery onSelect={setSelectedId} selectedId={selectedId} tasks={[task('A'), task('B')]} />
  </QueryClientProvider>
}

afterEach(() => { cleanup(); queryClient.clear() })

it('loads only the chosen mission and never paints a late preview into a different mission', async () => {
  const calls: string[] = []
  let changed = false
  let resolvePreview!: (value: unknown) => void
  const delayed = new Promise(resolve => { resolvePreview = resolve })

  const dispose = bindAgentOSApi(async <T,>(path: string) => {
    calls.push(path)

    if (path.endsWith('/results/file-A')) {
      if (changed) {throw new Error('File changed since verification')}

      return await delayed as T
    }

    const id = path.includes('/tasks/A/') ? 'A' : 'B'

    return { task_id: id, results: [file(id)] } as T
  }, () => () => undefined)

  try {
    render(<Gallery />)
    await screen.findByText('notes-A.txt')
    expect(calls).toEqual(['/tasks/A/results'])
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(calls).toContain('/tasks/A/results/file-A'))
    fireEvent.click(screen.getByRole('button', { name: 'Mission B' }))
    await screen.findByText('notes-B.txt')
    await act(async () => { resolvePreview({ ...file('A'), preview: 'Private A content', truncated: false }); await delayed })
    expect(screen.queryByText('notes-A.txt')).toBeNull()
    expect(screen.queryByText('Private A content')).toBeNull()
    changed = true
    fireEvent.click(screen.getByRole('button', { name: 'Mission A' }))
    await screen.findByText('notes-A.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('Private A content')).toBeNull()
    expect(calls.filter(path => path.endsWith('/results/file-A'))).toHaveLength(2)
    fireEvent.change(screen.getByRole('textbox', { name: 'Find mission or workspace' }), { target: { value: 'no-match' } })
    expect(screen.queryByText('notes-B.txt')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('No matching missions')
  } finally { dispose() }
})

it('offers recovery after a failed results read without showing an empty mission as successful', async () => {
  let failed = true

  const dispose = bindAgentOSApi(async <T,>() => {
    if (failed) {throw new Error('Temporary read failure')}

    return { task_id: 'A', results: [file('A')] } as T
  }, () => () => undefined)

  queryClient.setDefaultOptions({ queries: { retry: false } })

  try {
    render(<Gallery />)
    await screen.findByRole('alert')
    expect(screen.queryByText('No verified file outputs yet.')).toBeNull()
    failed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('notes-A.txt')
    expect(screen.queryByRole('alert')).toBeNull()
  } finally { dispose() }
})
