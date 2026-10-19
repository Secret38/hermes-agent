import { Button, SearchField, usePluginI18n } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { MissionResults } from './results'
import type { AgentOSTask } from './types'

interface ResultsGalleryProps {
  tasks: AgentOSTask[]
  selectedId?: string
  onSelect: (taskId: string) => void
}

/** Read the selected mission only; never fan out file requests across history. */
export function ResultsGallery({ tasks, selectedId, onSelect }: ResultsGalleryProps) {
  const t = usePluginI18n('agent-os')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()

  const visible = tasks.filter(task =>
    [task.goal, task.id, task.workspace_id ?? ''].some(value => value.toLocaleLowerCase().includes(needle))
  )

  const selected = visible.find(task => task.id === selectedId) ?? visible[0]

  return (
    <section aria-label={t('resultsGallery')} className="min-w-0 space-y-4">
      <header className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t('resultsGallery')}</h2>
        <p className="text-xs text-(--ui-text-secondary)">{t('resultsScope')}</p>
        {tasks.length > 0 && (
          <SearchField
            aria-label={t('findResultMission')}
            onChange={setQuery}
            placeholder={t('findResultMission')}
            value={query}
          />
        )}
      </header>
      {!selected ? (
        <p className="text-sm text-(--ui-text-secondary)" role="status">
          {t('noResultMissions')}
        </p>
      ) : (
        <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
          <nav aria-label={t('resultMissions')} className="min-w-0">
            <ul className="space-y-3">
              {visible.map(task => (
                <li className="min-w-0" key={task.id}>
                  <Button
                    aria-pressed={selected.id === task.id}
                    className="max-w-full justify-start whitespace-normal text-start"
                    onClick={() => onSelect(task.id)}
                    size="sm"
                    variant={selected.id === task.id ? 'secondary' : 'ghost'}
                  >
                    <span className="min-w-0 break-words">{task.goal}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 space-y-2">
            <h3 className="break-words text-sm font-medium text-foreground">{selected.goal}</h3>
            <p className="break-all text-xs text-(--ui-text-tertiary)">
              {t('missionIdentity')}: {selected.id}
            </p>
            {selected.workspace_id && (
              <p className="break-all text-xs text-(--ui-text-tertiary)">
                {t('workspace')}: {selected.workspace_id}
              </p>
            )}
            <MissionResults initiallyOpen key={selected.id} taskId={selected.id} />
          </div>
        </div>
      )}
    </section>
  )
}
