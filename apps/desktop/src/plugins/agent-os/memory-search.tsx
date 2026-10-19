import { Button, SearchField, usePluginI18n } from '@hermes/plugin-sdk'

import type { AgentOSLearningGraph, AgentOSLearningNode } from './types'

export function memoryCardForNode(node: AgentOSLearningNode | undefined, cards: AgentOSLearningGraph['memory']) {
  if (node?.kind !== 'memory') {return undefined}
  const match = node.id.match(/^memory:([^:]+):(\d+)(?::([a-f0-9]{12}))?$/)

  if (!match) {return undefined}
  const card = cards[Number(match[2])]

  // Older runtimes omit fingerprints on both card and ID. Never use an index alone
  // to associate current cards with a mismatched source or content identity.
  return card?.source === match[1] && card.fingerprint === match[3] ? card : undefined
}

export function searchMemoryGraph(graph: AgentOSLearningGraph, query: string): AgentOSLearningGraph {
  const needle = query.trim().toLocaleLowerCase()

  if (!needle) {return graph}

  const nodes = graph.nodes.filter(node => {
    const card = memoryCardForNode(node, graph.memory)

    return [node.label, node.id, node.category, node.memorySource, node.createdBy, card?.title, card?.body, card?.source]
      .some(value => value?.toLocaleLowerCase().includes(needle))
  })

  const ids = new Set(nodes.map(node => node.id))

  // Keep the original memory array: node IDs refer to its indices.
  return { ...graph, nodes, edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) }
}

interface MemorySearchProps {
  nodes: AgentOSLearningNode[]
  total: number
  query: string
  selectedId?: string
  onQuery: (value: string) => void
  onSelect: (id: string) => void
}

export function MemorySearch({ nodes, total, query, selectedId, onQuery, onSelect }: MemorySearchProps) {
  const t = usePluginI18n('agent-os')

  return <div className="min-w-0 space-y-3 p-3">
    <SearchField aria-label={t('findMemory')} onChange={onQuery} placeholder={t('findMemory')} value={query} />
    <p className="text-xs text-(--ui-text-secondary)">{t('memorySearchScope')}</p>
    <p className="text-xs tabular-nums text-(--ui-text-tertiary)" role="status">
      {nodes.length} / {total} · {nodes.length ? t('memoryEntries') : t('noMemoryMatches')}
    </p>
    <nav aria-label={t('memoryEntries')} className="aos-scrollbar max-h-52 overflow-y-auto">
      <ul className="space-y-1">
        {nodes.map(node => <li key={node.id}>
          <Button aria-pressed={selectedId === node.id} className="max-w-full justify-start whitespace-normal text-start"
            onClick={() => onSelect(node.id)} size="sm" variant={selectedId === node.id ? 'secondary' : 'ghost'}>
            <span className="min-w-0 break-words">{node.label}</span>
          </Button>
        </li>)}
      </ul>
    </nav>
  </div>
}
