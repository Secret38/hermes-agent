import { queryClient } from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { MemoryDetail } from './memory-detail'
import { MemoryEvidence } from './memory-evidence'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('@hermes/plugin-sdk', async () => {
  const { AGENT_OS_LOCALES } = await import('./i18n')
  const { atom } = await import('nanostores')

  return {
    ...(await import('@tanstack/react-query')),
    ...(await import('@/components/ui/button')),
    ...(await import('@/lib/query-client')),
    useValue: (await import('@nanostores/react')).useStore,
    host: { state: { profile: atom('default'), connectionId: atom('local') }, request: rpc },
    usePluginI18n: () => (key: keyof typeof AGENT_OS_LOCALES.en) => AGENT_OS_LOCALES.en[key]
  }
})

afterEach(() => { cleanup(); queryClient.clear(); rpc.mockReset() })

it('reads full content on demand and rejects mismatched or stale replies with retry', async () => {
  const nodeId = 'memory:memory:0:abcdef123456'
  const full = 'Full note beyond excerpt'

  rpc.mockResolvedValueOnce({ ok: true, id: 'other', kind: 'memory', content: 'Wrong note' })
    .mockResolvedValueOnce({ ok: true, id: nodeId, kind: 'memory', content: full })
    .mockResolvedValueOnce({ ok: false, message: 'stale' })
  render(<QueryClientProvider client={queryClient}><MemoryDetail excerpt="Excerpt" nodeId={nodeId} /></QueryClientProvider>)
  expect(rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Read full note' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('Wrong note')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reload note' }))
  await screen.findByText(full)
  expect(rpc).toHaveBeenCalledWith('learning.detail', { id: nodeId })
  fireEvent.click(screen.getByRole('button', { name: 'Reload note' }))
  await screen.findByRole('alert')
  expect(screen.queryByText(full)).toBeNull()
})

it('does not show a late note after selection changes and labels evidence without invented certainty', async () => {
  let resolve!: (value: unknown) => void
  const delayed = new Promise(r => { resolve = r })

  rpc.mockReturnValueOnce(delayed)

  const view = (id: string) => <QueryClientProvider client={queryClient}>
    <MemoryDetail excerpt={`Excerpt ${id}`} key={id} nodeId={id} />
    <MemoryEvidence edge={{ source: id, target: 'report-builder', kind: 'lexical', shared_terms: ['report'], name_match: true }} />
    <MemoryEvidence edge={{ source: 'one', target: 'two' }} />
  </QueryClientProvider>

  const mounted = render(view('A'))

  fireEvent.click(screen.getByRole('button', { name: 'Read full note' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
  mounted.rerender(view('B'))
  await act(async () => { resolve({ ok: true, id: 'A', kind: 'memory', content: 'Late private A' }); await delayed })
  expect(screen.queryByText('Late private A')).toBeNull()
  expect(screen.getByText('Excerpt B')).toBeTruthy()
  expect(screen.getByText('Shared words; inferred connection, not a verified fact')).toBeTruthy()
  expect(screen.getByText('No provenance supplied by this runtime')).toBeTruthy()
})
