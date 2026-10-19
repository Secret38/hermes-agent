import { queryClient } from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AGENT_OS_CONTEXT_KEY } from './api'
import { SemanticMemorySection } from './context'
import type { AgentOSLearningGraph } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { AGENT_OS_LOCALES } = await import('./i18n')
  const { atom } = await import('nanostores')

  return {
    ...(await import('@tanstack/react-query')),
    useValue: (await import('@nanostores/react')).useStore,
    host: { state: { profile: atom('default'), connectionId: atom(null) } },
    ...(await import('@/components/ui/button')),
    ...(await import('@/components/ui/search-field')),
    ...(await import('@/components/ui/codicon')),
    ...(await import('@/lib/utils')),
    ...(await import('@/lib/query-client')),
    usePluginI18n: () => (key: keyof typeof AGENT_OS_LOCALES.en) => AGENT_OS_LOCALES.en[key]
  }
})

function graph(): AgentOSLearningGraph {
  const memory = Array.from({ length: 36 }, (_, index) => ({
    source: 'project-notes', fingerprint: index.toString(16).padStart(12, '0'), title: `Note ${index}`, body: index === 35 ? 'Hidden aubergine decision' : `Body ${index}`
  }))

  return {
    nodes: [...memory.map((card, index) => ({ id: `memory:project-notes:${index}:${card.fingerprint}`, label: card.title, kind: 'memory' })),
      { id: 'skill:build', label: 'Builder skill', kind: 'skill', category: 'automation' }],
    memory, edges: [{ source: 'memory:project-notes:35:000000000023', target: 'skill:build' }], clusters: [],
    stats: { memory_nodes: memory.length, learned_skills: 1, memory_skill_edges: 1 }
  }
}

function mount(learning = graph()) {
  queryClient.setQueryData(AGENT_OS_CONTEXT_KEY, { learning })

  return render(<QueryClientProvider client={queryClient}><SemanticMemorySection /></QueryClientProvider>)
}

afterEach(() => { cleanup(); queryClient.clear() })

it('searches note bodies and sources and keeps list, canvas and details aligned', () => {
  mount()
  const search = screen.getByRole('textbox', { name: 'Search memories, skills or sources' })

  fireEvent.change(search, { target: { value: 'AUBERGINE' } })
  const list = screen.getByRole('navigation', { name: 'Memories and skills' })

  expect(within(list).getAllByRole('button')).toHaveLength(1)
  expect(screen.getByText('Hidden aubergine decision')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Note 35' }).every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Builder skill' }))
  expect((search as HTMLInputElement).value).toBe('')
  expect(within(list).getByRole('button', { name: 'Builder skill' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.change(search, { target: { value: 'project-notes' } })
  expect(within(list).getAllByRole('button')).toHaveLength(36)
  fireEvent.change(search, { target: { value: 'missing-result' } })
  expect(within(list).queryAllByRole('button')).toHaveLength(0)
  expect(screen.queryByText('Hidden aubergine decision')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('No matching entries')
})

it('shows a selection beyond the canvas cap and recovers when the entry disappears on refresh', async () => {
  const data = graph()

  data.edges = []
  mount(data)
  const list = screen.getByRole('navigation', { name: 'Memories and skills' })

  expect(screen.getAllByRole('button', { name: 'Note 35' })).toHaveLength(1)
  fireEvent.click(within(list).getByRole('button', { name: 'Note 35' }))
  expect(screen.getAllByRole('button', { name: 'Note 35' })).toHaveLength(2)
  expect(screen.getByText('Hidden aubergine decision')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Note 35' }).every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true)
  await act(async () => {
    queryClient.setQueryData(AGENT_OS_CONTEXT_KEY, { learning: { ...data, nodes: data.nodes.filter(node => node.id !== 'memory:project-notes:35:000000000023') } })
  })
  await waitFor(() => expect(screen.queryByText('Hidden aubergine decision')).toBeNull())
  expect(screen.getByText('Body 0')).toBeTruthy()
})
