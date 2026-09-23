import {
  type HermesPlugin,
  host,
  type KeybindContribution,
  KEYBINDS_AREA,
  PALETTE_AREA,
  type PaletteContribution,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution,
  STATUSBAR_AREAS
} from '@hermes/plugin-sdk'

import { bindAgentOSApi } from './api'
import { AgentOSForensicsPage } from './forensics'
import { AgentOSMissionControl, AgentOSStatusChip } from './page'

const openMissionControl = () => host.navigate('/agent-os')
const openForensics = () => host.navigate('/agent-os-replay')

const plugin: HermesPlugin = {
  id: 'agent-os',
  name: 'Agent OS',
  description:
    'Mission Control for durable tasks, plans, agents, runtime health, verification, recovery, operational memory, connections and replayable execution evidence.',
  defaultEnabled: true,

  register(ctx) {
    ctx.onDispose(bindAgentOSApi(ctx.rest, ctx.socket))

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/agent-os' } satisfies RouteContribution,
        render: () => <AgentOSMissionControl />
      },
      {
        id: 'forensics-page',
        area: ROUTES_AREA,
        data: { path: '/agent-os-replay' } satisfies RouteContribution,
        render: () => <AgentOSForensicsPage />
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 10,
        data: {
          codicon: 'circuit-board',
          label: 'Agent OS',
          path: '/agent-os'
        } satisfies SidebarNavContribution
      },
      {
        id: 'forensics-nav',
        area: SIDEBAR_NAV_AREA,
        order: 11,
        data: {
          codicon: 'history',
          label: 'Execution Replay',
          path: '/agent-os-replay'
        } satisfies SidebarNavContribution
      },
      {
        id: 'status',
        area: STATUSBAR_AREAS.right,
        order: 35,
        render: () => <AgentOSStatusChip />
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'agent-os.open',
          label: 'Agent OS: Open Mission Control',
          keywords: ['agent os', 'mission control', 'tasks', 'plans', 'memory', 'connections', 'runtime'],
          run: openMissionControl
        } satisfies PaletteContribution
      },
      {
        id: 'forensics',
        area: PALETTE_AREA,
        data: {
          id: 'agent-os.forensics',
          label: 'Agent OS: Open Execution Replay',
          keywords: ['agent os', 'replay', 'forensics', 'ledger', 'evidence', 'artifacts', 'verification', 'recovery'],
          run: openForensics
        } satisfies PaletteContribution
      },
      {
        id: 'open',
        area: KEYBINDS_AREA,
        data: {
          id: 'agent-os.open',
          category: 'view',
          defaults: ['mod+alt+o'],
          label: 'Open Agent OS Mission Control',
          run: openMissionControl
        } satisfies KeybindContribution
      }
    ])
  }
}

export default plugin