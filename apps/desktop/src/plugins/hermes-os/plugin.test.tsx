import { describe, expect, it, vi } from 'vitest'

import plugin from './plugin'

describe('hermes-os plugin shell', () => {
  it('registers the six workspace destinations, one sidebar entry, and palette navigation', () => {
    const registerMany = vi.fn()

    plugin.register({ registerMany } as never)

    const contributions = registerMany.mock.calls[0]?.[0] ?? []
    const routes = contributions.filter((entry: { area?: string }) => entry.area === 'routes')
    const nav = contributions.filter((entry: { area?: string }) => entry.area === 'sidebar.nav')
    const palette = contributions.filter((entry: { area?: string }) => entry.area === 'commandPalette')

    expect(routes.map((entry: { data?: { path?: string } }) => entry.data?.path)).toEqual([
      '/hermes-os',
      '/hermes-os/attention',
      '/hermes-os/projects',
      '/hermes-os/fleet',
      '/hermes-os/timeline',
      '/hermes-os/security'
    ])

    expect(nav).toHaveLength(1)
    expect(nav[0]?.data).toMatchObject({ label: 'Hermes OS', path: '/hermes-os' })
    expect(palette).toHaveLength(6)
  })
})
