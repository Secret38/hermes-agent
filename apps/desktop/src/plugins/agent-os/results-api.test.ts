import { afterEach, expect, it, vi } from 'vitest'

import { bindAgentOSApi, fetchAgentOSResults } from './api'

vi.mock('@hermes/plugin-sdk', async () => ({
  ...(await import('@/lib/query-client')),
  captureGatewayFileDownload: () => vi.fn()
}))

const result = {
  id: 'file', task_id: 'task', name: 'notes.txt', path: '/work/notes.txt',
  sha256: 'a'.repeat(64), bytes: 5, verified_at: '2026-10-19T00:00:00Z'
}

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined })

it('rejects previews that do not match the selected mission and verified file identity', async () => {
  let response: Record<string, unknown> = {}
  dispose = bindAgentOSApi(async <T,>(path: string) => (path.endsWith('/results')
    ? { task_id: result.task_id, results: [result] } : response) as T, () => () => undefined)
  const files = await fetchAgentOSResults(result.task_id)

  for (const mismatch of [
    { task_id: 'other-task' }, { id: 'other-file' }, { path: '/work/other.txt' },
    { sha256: 'b'.repeat(64) }, { preview: null }, { truncated: 'yes' }
  ]) {
    response = { ...result, preview: 'Notes', truncated: false, ...mismatch }
    await expect(files.preview(result.id)).rejects.toThrow()
  }
})

it('returns a matching preview and refuses unknown result IDs before making a request', async () => {
  const calls: string[] = []
  dispose = bindAgentOSApi(async <T,>(path: string) => {
    calls.push(path)

    return (path.endsWith('/results') ? { task_id: result.task_id, results: [result] }
      : { ...result, preview: 'Notes', truncated: false }) as T
  }, () => () => undefined)
  const files = await fetchAgentOSResults(result.task_id)
  await expect(files.preview(result.id)).resolves.toMatchObject({ task_id: result.task_id, preview: 'Notes' })
  const before = calls.length
  await expect(files.preview('not-listed')).rejects.toThrow()
  expect(calls).toHaveLength(before)
})
