import { cn, Codicon, host, STATUSBAR_AREAS, Tip } from '@hermes/plugin-sdk'

import { useHermesOperations } from './operations-data'
import { attentionOperationalTasks } from './selectors'

export function HermesOsAttentionIndicator() {
  const operations = useHermesOperations()
  const count = attentionOperationalTasks(operations.snapshots).length

  if (!operations.sources.length || count === 0) {
    return null
  }

  return (
    <Tip label={`${count} task${count === 1 ? '' : 's'} need inspection`}>
      <button
        className={cn(
          'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors',
          'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
        )}
        onClick={() => host.navigate('/hermes-os/attention')}
        type="button"
      >
        <Codicon name="bell" size="0.7rem" />
        <span>{count}</span>
      </button>
    </Tip>
  )
}

export const HERMES_OS_STATUSBAR_AREA = STATUSBAR_AREAS.right
