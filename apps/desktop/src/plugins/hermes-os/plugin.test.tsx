import { describe, expect, it, vi } from 'vitest'

import plugin from './plugin'

describe('hermes-os plugin shell', () => {
  it('registers routes, navigation, palette actions, and the global attention indicator', () => {
    const registerMany = vi.fn()

    plugin.register({ registerMany } as never)

    const contributions = registerMany.mock.calls[0]?.[0] ?? []
    const routes = contributions.filter((entry: { area?: string }) => entry.area === 'routes')
    const nav = contributions.filter((entry: { area?: string }) => entry.area === 'sidebar.nav')
    const palette = contributions.filter((entry: { area?: string }) => entry.area === 'palette')
    const status = contributions.filter((entry: { area?: string }) => entry.area === 'statusBar.right')

    expect(routes.map((entry: { data?: { path?: string } }) => entry.data?.path)).toEqual([
      '/hermes-os',
      '/hermes-os/attention',
      '/hermes-os/projects',
      '/hermes-os/fleet',
      '/hermes-os/timeline',
      '/hermes-os/automations',
      '/hermes-os/knowledge',
      '/hermes-os/security'
    ])

    expect(nav).toHaveLength(1)
    expect(nav[0]?.data).toMatchObject({ label: 'Hermes OS', path: '/hermes-os' })
    expect(palette).toHaveLength(8)
    expect(status).toHaveLength(1)
  })
})
