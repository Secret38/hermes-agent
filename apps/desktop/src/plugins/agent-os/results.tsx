import { Button, usePluginI18n, useQuery } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { fetchAgentOSResults } from './api'

export function MissionResults({ taskId }: { taskId: string }) {
  const t = usePluginI18n('agent-os')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const results = useQuery({
    queryKey: ['agent-os', 'results', taskId], queryFn: () => fetchAgentOSResults(taskId),
    enabled: open, refetchInterval: open ? 5000 : false
  })

  const preview = useQuery({
    queryKey: ['agent-os', 'result-preview', taskId, selected],
    queryFn: () => results.data!.preview(selected!), enabled: open && Boolean(selected) && Boolean(results.data),
    retry: false
  })

  return <section aria-label={t('results')} className="mt-2 min-w-0 space-y-2">
    <Button aria-expanded={open} onClick={() => setOpen(value => !value)} size="sm" variant="text">{t('results')}</Button>
    {open && <>
      <p className="text-xs text-(--ui-text-tertiary)">{t('resultsNote')}</p>
      {results.isPending && <p role="status">{t('loadingResults')}</p>}
      {results.isError && <p className="text-xs text-destructive" role="alert">{t('resultsFailed')}</p>}
      {results.data?.results.length === 0 && <p className="text-xs text-(--ui-text-secondary)">{t('noResults')}</p>}
      <ul className="space-y-3">
        {results.data?.results.map(result => <li className="min-w-0 text-xs" key={result.id}>
          <p className="break-all font-medium">{result.name}</p>
          <p className="break-all text-(--ui-text-tertiary)">{result.path}</p>
          <p className="text-(--ui-text-secondary)">{t('verifiedAt')}: {new Date(result.verified_at).toLocaleString()}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button onClick={() => selected === result.id ? void preview.refetch() : setSelected(result.id)} size="sm" variant="secondary">{t('previewResult')}</Button>
            <Button onClick={() => void results.data?.download(result.path, result.name)} size="sm" variant="text">{t('downloadResult')}</Button>
          </div>
        </li>)}
      </ul>
      {selected && preview.isPending && <p role="status">{t('loadingResults')}</p>}
      {selected && preview.isError && <p className="text-xs text-destructive" role="alert">{t('previewUnavailable')}</p>}
      {selected && preview.data && !preview.isError && !preview.isFetching && <div className="space-y-1">
        <p className="text-xs font-medium">{preview.data.name}</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs text-(--ui-text-secondary)">{preview.data.preview}</pre>
        {preview.data.truncated && <p className="text-xs text-(--ui-text-tertiary)">{t('previewTruncated')}</p>}
      </div>}
    </>}
  </section>
}
