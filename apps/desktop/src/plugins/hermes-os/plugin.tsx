import {
  type HermesPlugin,
  host,
  PALETTE_AREA,
  type PaletteContribution,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution,
  STATUSBAR_AREAS
} from '@hermes/plugin-sdk'

import { HermesOsAttentionIndicator } from './attention-indicator'
import { HermesOsPage, type HermesOsSection } from './page'

interface HermesOsRoute {
  icon: string
  label: string
  path: string
  section: HermesOsSection
}

const ROUTES: readonly HermesOsRoute[] = [
  { icon: 'dashboard', label: 'Mission Control', path: '/hermes-os', section: 'mission' },
  { icon: 'bell', label: 'What Needs Me', path: '/hermes-os/attention', section: 'attention' },
  { icon: 'project', label: 'Projects', path: '/hermes-os/projects', section: 'projects' },
  { icon: 'hubot', label: 'Fleet', path: '/hermes-os/fleet', section: 'fleet' },
  { icon: 'graph', label: 'Timeline', path: '/hermes-os/timeline', section: 'timeline' },
  { icon: 'clock', label: 'Automations', path: '/hermes-os/automations', section: 'automations' },
  { icon: 'symbol-structure', label: 'Knowledge', path: '/hermes-os/knowledge', section: 'knowledge' },
  { icon: 'shield', label: 'Security', path: '/hermes-os/security', section: 'security' }
]

const plugin: HermesPlugin = {
  id: 'hermes-os',
  name: 'Hermes OS',
  description: 'Agent operations control plane: mission control, attention, projects, fleet, timeline, automations, knowledge, and security.',
  defaultEnabled: true,
  register(ctx) {
    ctx.registerMany([
      ...ROUTES.map(
        route =>
          ({
            id: `route-${route.section}`,
            area: ROUTES_AREA,
            title: route.label,
            data: { path: route.path } satisfies RouteContribution,
            render: () => <HermesOsPage section={route.section} />
          }) as const
      ),
      {
        id: 'attention-status',
        area: STATUSBAR_AREAS.right,
        order: 70,
        render: () => <HermesOsAttentionIndicator />
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 15,
        data: {
          codicon: 'dashboard',
          label: 'Hermes OS',
          path: '/hermes-os'
        } satisfies SidebarNavContribution
      },
      ...ROUTES.map(
        route =>
          ({
            id: `palette-${route.section}`,
            area: PALETTE_AREA,
            data: {
              id: `hermes-os.${route.section}`,
              label: `Hermes OS: ${route.label}`,
              keywords: ['hermes os', 'operations', route.label.toLowerCase()],
              run: () => host.navigate(route.path)
            } satisfies PaletteContribution
          }) as const
      )
    ])
  }
}

export default plugin
