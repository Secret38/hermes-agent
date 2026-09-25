import { cn, Codicon, host, useQuery } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { AGENT_OS_CONTEXT_KEY, fetchAgentOSContext } from './api'
import type {
  AgentOSLearningNode,
  AgentOSMcpConnection,
  AgentOSMemoryProviderConnection
} from './types'
import { SemanticKnowledgeCanvas } from './visual-intelligence'

function LoadingPanel({ label }: { label: string }) {
  return (
    <section className="aos-panel grid min-h-40 place-items-center p-6 text-center">
      <div className="flex items-center gap-2 text-xs text-(--ui-text-tertiary)">
        <Codicon className="animate-spin" name="loading" size="0.8rem" />
        {label}
      </div>
    </section>
  )
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section className="aos-panel p-4">
      <div className="flex items-start gap-2">
        <Codicon className="mt-0.5 shrink-0 text-destructive" name="warning" size="0.8rem" />
        <div>
          <div className="text-xs font-medium text-foreground">Context unavailable</div>
          <div className="mt-1 text-[0.65rem] leading-relaxed text-(--ui-text-tertiary)">{message}</div>
        </div>
      </div>
    </section>
  )
}

function Stat({
  icon,
  label,
  value
}: {
  icon: string
  label: string
  value: number | string
}) {
  return (
    <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="aos-kicker">{label}</span>
        <Codicon className="text-(--ui-text-tertiary)" name={icon} size="0.72rem" />
      </div>
      <div className="mt-1.5 text-base font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function formatMemoryTimestamp(value: null | number | undefined): string {
  if (!value) {return 'unknown'}

  const milliseconds = value < 10_000_000_000 ? value * 1000 : value
  const date = new Date(milliseconds)

  if (Number.isNaN(date.getTime())) {return 'unknown'}

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function memoryCardForNode(
  node: AgentOSLearningNode | undefined,
  cards: Array<{ source: string; title: string; body: string }>
) {
  if (!node || node.kind !== 'memory') {
    return undefined
  }

  const match = node.id.match(/^memory:[^:]+:(\d+)$/)

  if (!match) {
    return undefined
  }

  return cards[Number(match[1])]
}

export function SemanticMemorySection() {
  const { data, error } = useQuery({
    queryFn: fetchAgentOSContext,
    queryKey: AGENT_OS_CONTEXT_KEY,
    refetchInterval: 60_000
  })

  const [selectedId, setSelectedId] = useState<string>()

  if (error) {
    return <ErrorPanel message={error instanceof Error ? error.message : String(error)} />
  }

  if (!data) {
    return <LoadingPanel label="Reading semantic memory and learned skills…" />
  }

  const graph = data.learning

  const orderedNodes = [...graph.nodes].sort(
    (a, b) =>
      Number(b.kind === 'memory') - Number(a.kind === 'memory') ||
      (b.useCount ?? 0) - (a.useCount ?? 0) ||
      a.label.localeCompare(b.label)
  )

  const selected = selectedId ? graph.nodes.find(node => node.id === selectedId) : orderedNodes[0]
  const selectedCard = memoryCardForNode(selected, graph.memory)
  const edgeCountByNode = new Map<string, number>()

  for (const edge of graph.edges) {
    edgeCountByNode.set(edge.source, (edgeCountByNode.get(edge.source) ?? 0) + 1)
    edgeCountByNode.set(edge.target, (edgeCountByNode.get(edge.target) ?? 0) + 1)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat icon="sparkle" label="Learned skills" value={graph.stats.learned_skills ?? 0} />
        <Stat icon="note" label="Memory nodes" value={graph.stats.memory_nodes ?? 0} />
        <Stat icon="git-merge" label="Memory ↔ skill" value={graph.stats.memory_skill_edges ?? 0} />
        <Stat icon="type-hierarchy" label="Graph edges" value={graph.edges.length} />
      </div>

      <section className="aos-panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-3.5 py-3">
          <div className="flex items-center gap-2">
            <Codicon className="text-(--ui-text-tertiary)" name="type-hierarchy" size="0.8rem" />
            <div>
              <div className="text-xs font-semibold text-foreground">Semantic memory graph</div>
              <div className="mt-0.5 text-[0.6rem] text-(--ui-text-tertiary)">
                Hermes memory chunks linked to learned/profile skills by declared and lexical relationships
              </div>
            </div>
          </div>
          {graph.error && <span className="text-[0.6rem] text-destructive">{graph.error}</span>}
        </div>

        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.55fr)]">
          <div className="min-h-64 overflow-hidden rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
            <SemanticKnowledgeCanvas
              graph={graph}
              onSelect={setSelectedId}
              selectedId={selected?.id}
            />
          </div>

          <aside className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-3">
            {selected ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="aos-kicker">{selected.kind === 'memory' ? 'Memory' : 'Learned skill'}</div>
                    <div className="mt-1.5 text-sm font-semibold leading-snug text-foreground">{selected.label}</div>
                  </div>
                  <Codicon
                    className="shrink-0 text-(--ui-text-tertiary)"
                    name={selected.kind === 'memory' ? 'note' : 'sparkle'}
                    size="0.9rem"
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-1.5 text-[0.58rem]">
                  <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2">
                    <div className="aos-kicker">Source</div>
                    <div className="mt-1 truncate text-(--ui-text-secondary)">
                      {selected.kind === 'memory' ? selected.memorySource || selectedCard?.source || 'memory' : selected.createdBy || 'profile'}
                    </div>
                  </div>
                  <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2">
                    <div className="aos-kicker">Created</div>
                    <div className="mt-1 truncate text-(--ui-text-secondary)">{formatMemoryTimestamp(selected.timestamp)}</div>
                  </div>
                  <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2">
                    <div className="aos-kicker">Usage</div>
                    <div className="mt-1 tabular-nums text-(--ui-text-secondary)">{selected.useCount ?? 0} uses</div>
                  </div>
                  <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2">
                    <div className="aos-kicker">Graph</div>
                    <div className="mt-1 tabular-nums text-(--ui-text-secondary)">{edgeCountByNode.get(selected.id) ?? 0} links</div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded border border-(--ui-stroke-tertiary) px-1.5 py-0.5 text-[0.54rem] text-(--ui-text-tertiary)">
                    {selected.category || selected.memorySource || 'general'}
                  </span>
                  {selected.state && (
                    <span className="rounded border border-(--ui-stroke-tertiary) px-1.5 py-0.5 text-[0.54rem] uppercase tracking-[0.05em] text-(--ui-text-tertiary)">
                      {selected.state}
                    </span>
                  )}
                  {selected.pinned && (
                    <span className="inline-flex items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-1.5 py-0.5 text-[0.54rem] text-(--ui-text-tertiary)">
                      <Codicon name="pinned" size="0.56rem" />
                      pinned
                    </span>
                  )}
                </div>

                {selectedCard && (
                  <div className="aos-scrollbar mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2.5 text-[0.65rem] leading-relaxed text-(--ui-text-secondary)">
                    {selectedCard.body}
                  </div>
                )}

                <div className="mt-3 border-t border-(--ui-stroke-tertiary) pt-2">
                  <div className="aos-kicker">Connected to</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {graph.edges
                      .filter(edge => edge.source === selected.id || edge.target === selected.id)
                      .slice(0, 12)
                      .map(edge => {
                        const other = edge.source === selected.id ? edge.target : edge.source
                        const node = graph.nodes.find(item => item.id === other)

                        return (
                          <button
                            aria-label={node?.label || other}
                            className="max-w-full truncate rounded border border-(--ui-stroke-tertiary) px-1.5 py-1 text-[0.58rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
                            key={`${edge.source}->${edge.target}`}
                            onClick={() => setSelectedId(other)}
                            type="button"
                          >
                            {node?.label || other}
                          </button>
                        )
                      })}
                  </div>
                </div>
              </>
            ) : (
              <div className="grid min-h-48 place-items-center text-xs text-(--ui-text-tertiary)">No semantic memory yet.</div>
            )}
          </aside>
        </div>

        {graph.clusters.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-(--ui-stroke-tertiary) px-3 py-2.5">
            {graph.clusters.slice(0, 12).map(cluster => (
              <span
                className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2 py-1 text-[0.6rem] text-(--ui-text-tertiary)"
                key={cluster.category}
              >
                {cluster.category} · <span className="tabular-nums">{cluster.count}</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function connectionBadge(enabled: boolean, active = false): { label: string; className: string } {
  if (active) {
    return {
      label: 'ACTIVE',
      className: 'border-[color-mix(in_srgb,#3fa779_40%,var(--ui-stroke-tertiary))] text-[#3fa779]'
    }
  }

  return enabled
    ? { label: 'CONFIGURED', className: 'border-(--ui-stroke-tertiary) text-(--ui-text-secondary)' }
    : { label: 'DISABLED', className: 'border-(--ui-stroke-tertiary) text-(--ui-text-tertiary)' }
}

function McpCard({ connection }: { connection: AgentOSMcpConnection }) {
  const badge = connectionBadge(connection.enabled)

  return (
    <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{connection.name}</div>
          <div className="mt-0.5 truncate text-[0.6rem] text-(--ui-text-tertiary)">
            {connection.transport}
            {connection.target ? ` · ${connection.target}` : ''}
          </div>
        </div>
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[0.54rem] font-medium tracking-[0.06em]', badge.className)}>
          {badge.label}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.58rem] text-(--ui-text-tertiary)">
        <span>auth {connection.auth || 'none'}</span>
        {connection.tool_count != null && <span>{connection.tool_count} selected tools</span>}
        {connection.error && <span className="text-destructive">{connection.error}</span>}
      </div>
    </div>
  )
}

function MemoryProviderCard({ provider }: { provider: AgentOSMemoryProviderConnection }) {
  const enabled = provider.available && provider.configured
  const badge = connectionBadge(enabled, provider.active)

  return (
    <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{provider.name}</div>
          <div className="mt-0.5 line-clamp-2 text-[0.6rem] leading-relaxed text-(--ui-text-tertiary)">
            {provider.description || provider.status.replaceAll('_', ' ')}
          </div>
        </div>
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[0.54rem] font-medium tracking-[0.06em]', badge.className)}>
          {badge.label}
        </span>
      </div>
      <div className="mt-2 text-[0.58rem] text-(--ui-text-tertiary)">
        status {provider.status.replaceAll('_', ' ')}
      </div>
    </div>
  )
}

export function ExternalConnectionsSection() {
  const { data, error } = useQuery({
    queryFn: fetchAgentOSContext,
    queryKey: AGENT_OS_CONTEXT_KEY,
    refetchInterval: 60_000
  })

  if (error) {
    return <ErrorPanel message={error instanceof Error ? error.message : String(error)} />
  }

  if (!data) {
    return <LoadingPanel label="Discovering configured integrations…" />
  }

  const mcp = data.integrations.mcp_servers
  const providers = data.integrations.memory_providers

  return (
    <section className="aos-panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-3.5 py-3">
        <div className="flex items-start gap-2">
          <Codicon className="mt-0.5 text-(--ui-text-tertiary)" name="plug" size="0.8rem" />
          <div>
            <div className="text-xs font-semibold text-foreground">External connections</div>
            <div className="mt-0.5 text-[0.6rem] text-(--ui-text-tertiary)">
              Profile-scoped MCP endpoints and memory providers visible to Hermes
            </div>
          </div>
        </div>
        <button
          className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2.5 py-1.5 text-[0.65rem] font-medium text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
          onClick={() => host.navigate('/capabilities')}
          type="button"
        >
          Manage capabilities
        </button>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="aos-kicker">MCP servers</span>
            <span className="text-[0.58rem] tabular-nums text-(--ui-text-tertiary)">{mcp.length}</span>
          </div>
          {mcp.length ? (
            <div className="grid gap-1.5 md:grid-cols-2">
              {mcp.map(connection => (
                <McpCard connection={connection} key={connection.name} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-(--ui-stroke-tertiary) p-4 text-center text-xs text-(--ui-text-tertiary)">
              No MCP servers configured.
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="aos-kicker">Memory providers</span>
            <span className="text-[0.58rem] text-(--ui-text-tertiary)">active · {providers.active}</span>
          </div>
          {providers.providers.length ? (
            <div className="grid gap-1.5 md:grid-cols-2">
              {providers.providers.map(provider => (
                <MemoryProviderCard key={provider.name} provider={provider} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-(--ui-stroke-tertiary) p-4 text-center text-xs text-(--ui-text-tertiary)">
              Built-in memory is active; no external memory provider is configured.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
