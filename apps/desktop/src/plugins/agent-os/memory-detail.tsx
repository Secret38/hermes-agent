import { Button, host, usePluginI18n, useQuery, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

interface MemoryDetailProps {
  nodeId: string
  excerpt: string
}

interface NodeDetail {
  ok: boolean
  id?: string | null
  kind?: string | null
  content?: string | null
}

export function MemoryDetail({ nodeId, excerpt }: MemoryDetailProps) {
  const t = usePluginI18n('agent-os')
  const profile = useValue(host.state.profile)
  const connectionId = useValue(host.state.connectionId)
  const [opened, setOpened] = useState(false)

  const detail = useQuery({
    queryKey: ['agent-os', 'memory-detail', connectionId, profile, nodeId],
    queryFn: async () => {
      const result = await host.request<NodeDetail>('learning.detail', { id: nodeId })

      if (!result.ok || result.id !== nodeId || result.kind !== 'memory' || typeof result.content !== 'string') {
        throw new Error('Memory detail does not match the selected entry')
      }

      return result.content
    },
    enabled: opened,
    staleTime: 0,
    retry: false
  })

  return <div className="mt-3 space-y-2">
    <Button onClick={() => {
      if (opened) {void detail.refetch()} else {setOpened(true)}
    }} size="sm" variant="ghost">{t(opened ? 'reloadMemory' : 'readFullMemory')}</Button>
    {opened && detail.isFetching ? <p role="status">{t('loadingMemory')}</p>
      : opened && detail.error ? <p className="text-xs text-destructive" role="alert">{t('memoryReadFailed')}</p>
        : <div className="aos-scrollbar max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-(--ui-text-secondary)">
          {opened ? detail.data : excerpt}
        </div>}
  </div>
}
