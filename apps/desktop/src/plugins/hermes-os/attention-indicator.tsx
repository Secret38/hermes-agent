import { cn, Codicon, host, Tip } from '@hermes/plugin-sdk'

import { useAutomationSummary } from './automation-data'
import { useHumanGates } from './human-gates'
import { useHermesOperations } from './operations-data'
import { attentionOperationalTasks } from './selectors'

export function HermesOsAttentionIndicator() {
  const operations = useHermesOperations()
  const humanGates = useHumanGates()
  const automations = useAutomationSummary()
  const taskAttention = attentionOperationalTasks(operations.snapshots).length
  const automationAttention = automations.isError ? 0 : automations.failed.length
  const count = humanGates.length + taskAttention + automationAttention

  if (count === 0) {
    return null
  }

  return (
    <Tip label={`${count} item${count === 1 ? '' : 's'} need your attention`}>
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

